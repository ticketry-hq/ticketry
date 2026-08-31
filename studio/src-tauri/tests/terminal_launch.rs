mod common;

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::submitted_launch_authority::launch_service;
use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID,
};
use muxed_studio_lib::launch::authority::{
    InteractiveLaunchAuthority, LaunchAuthorityError, ResolvedLaunchMaterial,
};
use muxed_studio_lib::launch::terminal_session::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchKind,
};
use muxed_studio_lib::terminal::launch::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_entities::terminals::launch_material;

struct RecordingRuntime {
    database: sea_orm::DatabaseConnection,
    created: Mutex<BTreeSet<String>>,
    owned: Mutex<BTreeSet<String>>,
    materialized: Mutex<Vec<launch_material::Model>>,
    preparation_observed: Mutex<bool>,
}

struct FixedObservationRuntime {
    observation: TerminalRuntimeObservation,
    creates: Mutex<usize>,
}

struct RejectingPreflightRuntime;

struct DefaultingLaunchAuthority;

#[async_trait]
impl InteractiveLaunchAuthority for DefaultingLaunchAuthority {
    async fn resolve(
        &self,
        _request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        Ok(ResolvedLaunchMaterial {
            provider: Some("codex".to_owned()),
            ..ResolvedLaunchMaterial::default()
        })
    }
}

#[async_trait]
impl TerminalLaunchRuntime for RejectingPreflightRuntime {
    async fn preflight(&self, _request: &CreateTerminalSession) -> Result<(), TerminalLaunchError> {
        Err(TerminalLaunchError::unusable_folder(
            "The configured module folder became inaccessible.",
        ))
    }

    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        panic!("a failed preflight must not inspect the runtime")
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        panic!("a failed preflight must not create the runtime")
    }
}

#[async_trait]
impl TerminalLaunchRuntime for FixedObservationRuntime {
    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        self.observation.clone()
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        *self.creates.lock().unwrap() += 1;
        Ok(())
    }
}

struct PostCreateUnavailableRuntime {
    created: Mutex<bool>,
}

#[async_trait]
impl TerminalLaunchRuntime for PostCreateUnavailableRuntime {
    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        if *self.created.lock().unwrap() {
            TerminalRuntimeObservation::Unavailable
        } else {
            TerminalRuntimeObservation::Missing
        }
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        *self.created.lock().unwrap() = true;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await
    }
}

struct RetryableMissingRuntime {
    attempts: Mutex<usize>,
    run_id: Mutex<Option<String>>,
}

struct FailedStartRuntime;

#[async_trait]
impl TerminalLaunchRuntime for FailedStartRuntime {
    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        TerminalRuntimeObservation::Missing
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        Err(TerminalLaunchError::runtime_start_failed(
            "tmux rejected the hosted command",
        ))
    }
}

#[async_trait]
impl TerminalLaunchRuntime for RetryableMissingRuntime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.run_id.lock().unwrap().as_deref() == Some(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("pt-{agent_run_id}"),
                runtime_namespace: "test-runtime".to_owned(),
            })
        } else {
            TerminalRuntimeObservation::Missing
        }
    }

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        let should_create = {
            let mut attempts = self.attempts.lock().unwrap();
            *attempts += 1;
            *attempts > 1
        };
        if !should_create {
            return Ok(());
        }
        *self.run_id.lock().unwrap() = Some(material.agent_run_id.clone());
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await
    }
}

impl RecordingRuntime {
    fn new(database: sea_orm::DatabaseConnection) -> Self {
        Self {
            database,
            created: Mutex::new(BTreeSet::new()),
            owned: Mutex::new(BTreeSet::new()),
            materialized: Mutex::new(Vec::new()),
            preparation_observed: Mutex::new(false),
        }
    }

    fn create_count(&self) -> usize {
        self.materialized.lock().unwrap().len()
    }

    fn runtime_count(&self) -> usize {
        self.created.lock().unwrap().len()
    }
}

#[async_trait]
impl TerminalLaunchRuntime for RecordingRuntime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.owned.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("pt-{agent_run_id}"),
                runtime_namespace: "test-runtime".to_owned(),
            })
        } else if self.created.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Foreign
        } else {
            TerminalRuntimeObservation::Missing
        }
    }

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        let prepared: i64 = scalar(
            &self.database,
            &format!(
                "SELECT COUNT(*) AS value FROM runs_launch_effects e JOIN agent_runs r ON r.id=e.agent_run_id JOIN terminal_launch_material m ON m.effect_id=e.effect_id WHERE e.effect_id='{}'",
                material.effect_id
            ),
            "value",
        )
        .await;
        let premature_session: i64 = scalar(
            &self.database,
            &format!(
                "SELECT COUNT(*) AS value FROM agent_terminal_sessions WHERE agent_run_id='{}'",
                material.agent_run_id
            ),
            "value",
        )
        .await;
        assert_eq!(prepared, 1, "durable intent must commit before execution");
        assert_eq!(
            premature_session, 0,
            "session settles only after verification"
        );
        *self.preparation_observed.lock().unwrap() = true;
        self.materialized.lock().unwrap().push(material.clone());
        self.created
            .lock()
            .unwrap()
            .insert(material.agent_run_id.clone());
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        self.owned
            .lock()
            .unwrap()
            .insert(material.agent_run_id.clone());
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await?;
        Ok(())
    }
}

fn request(id: &str, kind: TerminalLaunchKind) -> CreateTerminalSession {
    let target_id = match kind {
        TerminalLaunchKind::Planning | TerminalLaunchKind::Instant | TerminalLaunchKind::Shell => {
            MODULE_ID
        }
        _ => TASK_ID,
    };
    let working_directory_identity = match kind {
        TerminalLaunchKind::Task | TerminalLaunchKind::Automation => {
            format!("task:{}", TASK_ID.replace('-', ""))
        }
        TerminalLaunchKind::Planning | TerminalLaunchKind::Instant | TerminalLaunchKind::Shell => {
            format!("module:{}", MODULE_ID.replace('-', ""))
        }
        TerminalLaunchKind::DocumentChat => {
            format!("document:{}", TASK_ID.replace('-', ""))
        }
    };
    CreateTerminalSession {
        client_request_id: id.to_owned(),
        project_id: PROJECT_ID.to_owned(),
        issue_id: match kind {
            TerminalLaunchKind::Planning
            | TerminalLaunchKind::Instant
            | TerminalLaunchKind::Shell => MODULE_ID.to_owned(),
            _ => TASK_ID.to_owned(),
        },
        module_id: MODULE_ID.to_owned(),
        target_id: target_id.to_owned(),
        kind,
        provider: Some("codex".to_owned()),
        model: Some("gpt-5".to_owned()),
        reasoning: Some("high".to_owned()),
        policy_reference: Some("workflow/review@7".to_owned()),
        prompt: Some("deliberate prompt".to_owned()),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: vec!["seaography-graphql".to_owned()],
        working_directory_identity,
        design_directory_identity: None,
        document_relative_path: (kind == TerminalLaunchKind::DocumentChat)
            .then(|| "T864--terminal-harness/SPEC.md".to_owned()),
        columns: 120,
        rows: 40,
    }
}

fn shell_request(id: &str) -> CreateTerminalSession {
    CreateTerminalSession {
        client_request_id: id.to_owned(),
        project_id: PROJECT_ID.to_owned(),
        issue_id: MODULE_ID.to_owned(),
        module_id: MODULE_ID.to_owned(),
        target_id: MODULE_ID.to_owned(),
        kind: TerminalLaunchKind::Shell,
        provider: None,
        model: None,
        reasoning: None,
        policy_reference: None,
        prompt: None,
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: Vec::new(),
        working_directory_identity: format!("module:{}", MODULE_ID.replace('-', "")),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 40,
    }
}

#[tokio::test]
async fn one_request_prepares_executes_verifies_and_replays_one_session() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let service = launch_service(database.clone(), runtime.clone());
    let launch = request("terminal-create-replay", TerminalLaunchKind::Task);

    let first = service.create(launch.clone()).await.unwrap();
    let replay = service.create(launch).await.unwrap();

    assert_eq!(first, replay);
    assert_eq!(runtime.create_count(), 1);
    assert!(*runtime.preparation_observed.lock().unwrap());
    assert_eq!(first.runtime_namespace.as_deref(), Some("test-runtime"));
    assert_eq!(first.scope, "task");
    let launch_state: Option<String> = scalar(
        &database,
        &format!(
            "SELECT launch_state AS value FROM agent_runs WHERE id='{}'",
            first.agent_run_id
        ),
        "value",
    )
    .await;
    let launch_model: Option<String> = scalar(
        &database,
        &format!(
            "SELECT launch_model AS value FROM agent_runs WHERE id='{}'",
            first.agent_run_id
        ),
        "value",
    )
    .await;
    assert_eq!(launch_state.as_deref(), Some("Todo"));
    assert_eq!(launch_model.as_deref(), Some("gpt-5"));
    assert_eq!(count(&database, "agent_runs").await, 3);
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
    assert_eq!(count(&database, "terminal_launch_material").await, 1);
    assert_eq!(count(&database, "agent_terminal_sessions").await, 3);

    let evidence: String = scalar(
        &database,
        "SELECT runtime_evidence FROM runs_launch_effects LIMIT 1",
        "runtime_evidence",
    )
    .await;
    assert!(evidence.contains("verified"));
    assert!(!evidence.contains("deliberate prompt"));
    assert!(!evidence.contains("token"));
}

#[tokio::test]
async fn interactive_identity_only_launch_resolves_provider_before_full_validation() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let service = TerminalLaunchService::new(database, runtime)
        .with_authority(Arc::new(DefaultingLaunchAuthority));
    let mut launch = request("terminal-default-provider", TerminalLaunchKind::Task);
    launch.provider = None;

    let created = service
        .create(launch)
        .await
        .expect("launch authority supplies the omitted provider");

    assert_eq!(created.agent.as_deref(), Some("codex"));
}

#[tokio::test]
async fn module_shell_derives_routing_and_persists_no_agent_metadata() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let service = launch_service(database.clone(), runtime.clone());

    let first = service
        .create_module_shell(
            "shell-create-replay".to_owned(),
            MODULE_ID.to_owned(),
            100,
            30,
        )
        .await
        .unwrap();
    let replay = service
        .create_module_shell(
            "shell-create-replay".to_owned(),
            MODULE_ID.to_owned(),
            100,
            30,
        )
        .await
        .unwrap();

    assert_eq!(first, replay);
    assert_eq!(first.scope, "shell");
    assert_eq!(first.agent, None);
    assert_eq!(
        first.task_id,
        ticketry_documents::SCRATCH_TASK_ID.replace('-', "")
    );
    assert_eq!(first.module_id, MODULE_ID.replace('-', ""));
    assert_eq!(runtime.create_count(), 1);
    let material = runtime.materialized.lock().unwrap()[0].clone();
    assert_eq!(material.issue_id, MODULE_ID.replace('-', ""));
    assert_eq!(material.project_id, PROJECT_ID.replace('-', ""));
    assert_eq!(material.provider, None);
    assert_eq!(material.model, None);
    assert_eq!(material.reasoning, None);
    assert_eq!(material.prompt, None);
    assert_eq!(material.required_skills, serde_json::json!([]));
    assert_eq!(material.design_directory_identity, None);
    assert_eq!(material.resume_from_agent_run_id, None);
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT agent, model, reasoning, launch_state, launch_model, provider_session_id FROM agent_runs WHERE id='{}'",
                first.agent_run_id
            ),
        ))
        .await
        .unwrap()
        .unwrap();
    for column in [
        "agent",
        "model",
        "reasoning",
        "launch_state",
        "launch_model",
        "provider_session_id",
    ] {
        assert_eq!(row.try_get::<Option<String>>("", column).unwrap(), None);
    }
    let restarted = service
        .create_module_shell(
            "shell-create-fresh".to_owned(),
            MODULE_ID.to_owned(),
            100,
            30,
        )
        .await
        .unwrap();
    assert_ne!(restarted.agent_run_id, first.agent_run_id);
}

#[tokio::test]
async fn a_folder_that_becomes_unusable_before_preparation_leaves_no_launch_rows() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let before_runs = count(&database, "agent_runs").await;
    let before_effects = count(&database, "runs_launch_effects").await;
    let before_material = count(&database, "terminal_launch_material").await;

    let error = launch_service(database.clone(), Arc::new(RejectingPreflightRuntime))
        .create(request("folder-became-unusable", TerminalLaunchKind::Task))
        .await
        .unwrap_err();

    assert_eq!(error.code_str(), "module_folder_unusable");
    assert_eq!(count(&database, "agent_runs").await, before_runs);
    assert_eq!(
        count(&database, "runs_launch_effects").await,
        before_effects
    );
    assert_eq!(
        count(&database, "terminal_launch_material").await,
        before_material
    );
}

#[tokio::test]
async fn request_identity_rejects_rebinding_and_fresh_requests_launch_every_kind() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let service = launch_service(database.clone(), runtime.clone());

    let original = request("terminal-create-conflict", TerminalLaunchKind::Task);
    service.create(original.clone()).await.unwrap();
    let mut rebound = original;
    rebound.provider = Some("claude".to_owned());
    let error = service.create(rebound).await.unwrap_err();
    assert_eq!(error.code_str(), "terminal_launch_conflict");

    for (index, kind) in [
        TerminalLaunchKind::Task,
        TerminalLaunchKind::Planning,
        TerminalLaunchKind::Instant,
        TerminalLaunchKind::DocumentChat,
        TerminalLaunchKind::Automation,
    ]
    .into_iter()
    .enumerate()
    {
        let row = service
            .create(request(&format!("terminal-kind-{index}"), kind))
            .await
            .unwrap();
        assert!(row.terminated_at.is_none());
    }
    assert_eq!(runtime.create_count(), 6);
}

#[tokio::test]
async fn graphql_create_contract_returns_a_stable_typed_error() {
    let harness = TerminalLifecycleHarness::start().await;
    ticketry_settings::publish_readiness(
        harness.data_directory(),
        &ticketry_settings::Slice2Readiness::complete(),
    )
    .unwrap();
    let response = harness
        .graphql(
            r#"mutation {
              terminal_session_create(
                client_request_id: "graphql-invalid"
                project_id: "project"
                issue_id: "issue"
                module_id: "module"
                target_id: "target"
                kind: "unsupported"
                provider: "codex"
                working_directory_identity: "module:module"
                columns: 80
                rows: 24
              ) { agentRunId }
            }"#,
            serde_json::json!({}),
        )
        .await;
    assert_eq!(
        response["errors"][0]["extensions"]["code"], "terminal_launch_invalid",
        "{response}"
    );
    assert!(!response.to_string().contains("graphql-invalid"));

    let response = harness
        .graphql(
            &format!(
                r#"mutation {{
                  terminal_session_create(
                    client_request_id: "graphql-composed"
                    project_id: "{PROJECT_ID}"
                    issue_id: "{TASK_ID}"
                    module_id: "{MODULE_ID}"
                    target_id: "{TASK_ID}"
                    kind: "task"
                    provider: "codex"
                    working_directory_identity: "task:{}"
                    columns: 80
                    rows: 24
                  ) {{ agentRunId }}
                }}"#,
                TASK_ID.replace('-', ""),
            ),
            serde_json::json!({}),
        )
        .await;
    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "terminal_runtime_unavailable",
        "the composed service should fail at its unconfigured runtime, not at resolver lookup: {response}"
    );
}

#[tokio::test]
async fn action_candidate_preparation_is_one_recoverable_commit() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));

    for (index, boundary, committed) in [
        (0, TerminalLaunchBoundary::MaterialPrepared, false),
        (1, TerminalLaunchBoundary::EffectPrepared, true),
    ] {
        let request_id = format!("terminal-action-prepare-{index}");
        let stopped = launch_service(database.clone(), runtime.clone())
            .stopping_once_at(boundary)
            .create(request(&request_id, TerminalLaunchKind::Task))
            .await;
        assert!(stopped.is_err(), "{boundary:?} must stop the response");

        let expected = i64::from(committed);
        assert_eq!(
            request_count(&database, "runs_launch_effects", &request_id).await,
            expected,
            "{boundary:?}: effect"
        );
        assert_eq!(
            request_count(&database, "terminal_launch_material", &request_id).await,
            expected,
            "{boundary:?}: material"
        );
        assert_eq!(
            run_count(&database, "agent_runs", &request_id).await,
            expected,
            "{boundary:?}: run"
        );
        assert_eq!(
            status_count(&database, &request_id).await,
            expected,
            "{boundary:?}: starting status"
        );
        assert_eq!(
            run_count(&database, "agent_terminal_sessions", &request_id).await,
            0,
            "{boundary:?}: session must not precede verified tmux"
        );
    }
    assert_eq!(runtime.runtime_count(), 0);
}

#[tokio::test]
async fn action_candidate_session_insert_rolls_back_with_effect_and_run_settlement() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let request_id = "terminal-action-settlement";
    let launch = request(request_id, TerminalLaunchKind::Task);

    let stopped = launch_service(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::SessionInserted)
        .create(launch.clone())
        .await;
    assert!(stopped.is_err());

    assert_eq!(runtime.runtime_count(), 1, "verified tmux survives");
    assert_eq!(
        run_count(&database, "agent_terminal_sessions", request_id).await,
        0,
        "the in-transaction session insert must roll back"
    );
    assert_eq!(effect_state(&database, request_id).await, "leased");
    assert_eq!(
        status_count(&database, request_id).await,
        1,
        "the running lifecycle fact must roll back with the session"
    );

    expire_launch_leases(&database).await;
    let recovery = launch_service(database.clone(), runtime.clone());
    recovery.reconcile().await.unwrap();
    let replay = recovery.create(launch).await.unwrap();

    assert_eq!(
        runtime.create_count(),
        1,
        "recovery must not duplicate tmux"
    );
    assert_eq!(effect_state(&database, request_id).await, "applied");
    assert_eq!(
        run_count(&database, "agent_terminal_sessions", request_id).await,
        1
    );
    assert_eq!(status_count(&database, request_id).await, 2);
    assert_eq!(replay.agent_run_id, run_id(&database, request_id).await);
}

#[tokio::test]
async fn crash_boundaries_recover_one_verified_launch_without_duplicate_facts() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let boundaries = [
        TerminalLaunchBoundary::RequestValidated,
        TerminalLaunchBoundary::MaterialPrepared,
        TerminalLaunchBoundary::EffectPrepared,
        TerminalLaunchBoundary::EffectClaimed,
        TerminalLaunchBoundary::PreEffectObserved,
        TerminalLaunchBoundary::OwnershipMetadataWritten,
        TerminalLaunchBoundary::SessionInserted,
        TerminalLaunchBoundary::EffectAndStatusSettled,
        TerminalLaunchBoundary::ResponseReady,
    ];

    for (index, boundary) in boundaries.into_iter().enumerate() {
        let request_id = format!("terminal-crash-{index}");
        let launch = request(&request_id, TerminalLaunchKind::Task);
        let before_runtimes = runtime.runtime_count();
        let stopped = launch_service(database.clone(), runtime.clone())
            .stopping_once_at(boundary)
            .create(launch.clone())
            .await;
        assert!(
            stopped.is_err(),
            "{boundary:?} must stop the first response"
        );

        expire_launch_leases(&database).await;
        let recovery = launch_service(database.clone(), runtime.clone());
        recovery.reconcile().await.unwrap();
        expire_launch_leases(&database).await;
        recovery.reconcile().await.unwrap();
        let authoritative = recovery.create(launch).await.unwrap();

        assert_eq!(runtime.runtime_count(), before_runtimes + 1, "{boundary:?}");
        assert_eq!(
            request_count(&database, "runs_launch_effects", &request_id).await,
            1
        );
        assert_eq!(
            request_count(&database, "terminal_launch_material", &request_id).await,
            1
        );
        assert_eq!(run_count(&database, "agent_runs", &request_id).await, 1);
        assert_eq!(
            run_count(&database, "agent_terminal_sessions", &request_id).await,
            1
        );
        assert_eq!(
            status_count(&database, &request_id).await,
            2,
            "{boundary:?}"
        );
        assert_eq!(effect_state(&database, &request_id).await, "applied");
        assert_eq!(
            authoritative.agent_run_id,
            run_id(&database, &request_id).await
        );
    }
}

#[tokio::test]
async fn shell_launch_uses_the_same_crash_safe_prepare_execute_settle_matrix() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let boundaries = [
        TerminalLaunchBoundary::RequestValidated,
        TerminalLaunchBoundary::MaterialPrepared,
        TerminalLaunchBoundary::EffectPrepared,
        TerminalLaunchBoundary::EffectClaimed,
        TerminalLaunchBoundary::PreEffectObserved,
        TerminalLaunchBoundary::OwnershipMetadataWritten,
        TerminalLaunchBoundary::SessionInserted,
        TerminalLaunchBoundary::EffectAndStatusSettled,
        TerminalLaunchBoundary::ResponseReady,
    ];

    for (index, boundary) in boundaries.into_iter().enumerate() {
        let request_id = format!("shell-crash-{index}");
        let launch = shell_request(&request_id);
        let before_runtimes = runtime.runtime_count();
        let stopped = launch_service(database.clone(), runtime.clone())
            .stopping_once_at(boundary)
            .create(launch.clone())
            .await;
        assert!(stopped.is_err(), "{boundary:?} must stop the response");

        expire_launch_leases(&database).await;
        let recovery = launch_service(database.clone(), runtime.clone());
        recovery.reconcile().await.unwrap();
        expire_launch_leases(&database).await;
        recovery.reconcile().await.unwrap();
        let authoritative = recovery.create(launch).await.unwrap();

        assert_eq!(runtime.runtime_count(), before_runtimes + 1, "{boundary:?}");
        assert_eq!(authoritative.scope, "shell");
        assert_eq!(authoritative.agent, None);
        assert_eq!(
            request_count(&database, "runs_launch_effects", &request_id).await,
            1
        );
        assert_eq!(
            request_count(&database, "terminal_launch_material", &request_id).await,
            1
        );
        assert_eq!(run_count(&database, "agent_runs", &request_id).await, 1);
        assert_eq!(
            run_count(&database, "agent_terminal_sessions", &request_id).await,
            1
        );
        assert_eq!(effect_state(&database, &request_id).await, "applied");
    }
}

#[tokio::test]
async fn crash_after_tmux_create_keeps_cleanup_intent_and_never_overwrites_partial_identity() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    let request_id = "terminal-partial-create";
    let launch = request(request_id, TerminalLaunchKind::Task);

    let stopped = launch_service(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::TmuxCreated)
        .create(launch)
        .await
        .unwrap_err();
    assert_eq!(stopped.code_str(), "terminal_launch_injected_stop");
    assert_eq!(runtime.runtime_count(), 1);
    assert_eq!(runtime.create_count(), 1);

    expire_launch_leases(&database).await;
    let recovery = launch_service(database.clone(), runtime.clone());
    let first = recovery.reconcile().await.unwrap();
    let second = recovery.reconcile().await.unwrap();

    assert_eq!(first.settled_failures, 1);
    assert_eq!(second.cleanup_pending, 1);
    assert_eq!(effect_state(&database, request_id).await, "cleanup_pending");
    assert_eq!(runtime.runtime_count(), 1);
    assert_eq!(runtime.create_count(), 1);
    assert_eq!(
        run_count(&database, "agent_terminal_sessions", request_id).await,
        0
    );
    assert_eq!(status_count(&database, request_id).await, 2);
}

#[tokio::test]
async fn unavailable_observation_defers_without_creating_or_ending_the_run() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(FixedObservationRuntime {
        observation: TerminalRuntimeObservation::Unavailable,
        creates: Mutex::new(0),
    });
    let request_id = "terminal-observation-unavailable";
    let service = launch_service(database.clone(), runtime.clone());

    let error = service
        .create(request(request_id, TerminalLaunchKind::Task))
        .await
        .unwrap_err();
    assert_eq!(error.code_str(), "terminal_runtime_unavailable");
    service.reconcile().await.unwrap();
    service.reconcile().await.unwrap();

    assert_eq!(*runtime.creates.lock().unwrap(), 0);
    assert_eq!(effect_state(&database, request_id).await, "prepared");
    assert_eq!(status_count(&database, request_id).await, 1);
    let ended: i64 = scalar(
        &database,
        &format!(
            "SELECT COUNT(*) AS value FROM agent_runs WHERE ended_at IS NOT NULL AND id=(SELECT agent_run_id FROM runs_launch_effects WHERE request_id='{request_id}')"
        ),
        "value",
    )
    .await;
    assert_eq!(ended, 0);
}

#[tokio::test]
async fn a_rejected_hosted_command_ends_the_run_without_a_phantom_session() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let request_id = "terminal-hosted-command-rejected";

    let error = launch_service(database.clone(), Arc::new(FailedStartRuntime))
        .create(request(request_id, TerminalLaunchKind::Task))
        .await
        .unwrap_err();

    assert_eq!(error.code_str(), "terminal_runtime_start_failed");
    assert_eq!(effect_state(&database, request_id).await, "failed");
    assert_eq!(
        run_count(&database, "agent_terminal_sessions", request_id).await,
        0
    );
    let ended: i64 = scalar(
        &database,
        &format!(
            "SELECT COUNT(*) AS value FROM agent_runs WHERE ended_at IS NOT NULL AND id=(SELECT agent_run_id FROM runs_launch_effects WHERE request_id='{request_id}')"
        ),
        "value",
    )
    .await;
    assert_eq!(ended, 1);
    assert_eq!(status_count(&database, request_id).await, 2);
}

#[tokio::test]
async fn foreign_and_ambiguous_identities_conflict_without_create() {
    for (suffix, observation) in [
        ("foreign", TerminalRuntimeObservation::Foreign),
        ("ambiguous", TerminalRuntimeObservation::Ambiguous),
    ] {
        let harness = TerminalLifecycleHarness::start().await;
        let database = harness.database().await;
        let runtime = Arc::new(FixedObservationRuntime {
            observation,
            creates: Mutex::new(0),
        });
        let request_id = format!("terminal-{suffix}-identity");
        let error = launch_service(database.clone(), runtime.clone())
            .create(request(&request_id, TerminalLaunchKind::Task))
            .await
            .unwrap_err();

        assert_eq!(error.code_str(), "terminal_runtime_identity_conflict");
        assert_eq!(*runtime.creates.lock().unwrap(), 0);
        assert_eq!(effect_state(&database, &request_id).await, "failed");
        assert_eq!(
            run_count(&database, "agent_terminal_sessions", &request_id).await,
            0
        );
    }
}

#[tokio::test]
async fn post_create_uncertainty_keeps_cleanup_intent_but_proved_absence_retries() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let uncertain_id = "terminal-post-create-unavailable";
    let uncertain = Arc::new(PostCreateUnavailableRuntime {
        created: Mutex::new(false),
    });
    let error = launch_service(database.clone(), uncertain)
        .create(request(uncertain_id, TerminalLaunchKind::Task))
        .await
        .unwrap_err();
    assert_eq!(error.code_str(), "terminal_runtime_unavailable");
    assert_eq!(
        effect_state(&database, uncertain_id).await,
        "cleanup_pending"
    );

    let retry_id = "terminal-post-create-missing";
    let retry = Arc::new(RetryableMissingRuntime {
        attempts: Mutex::new(0),
        run_id: Mutex::new(None),
    });
    let retry_service = launch_service(database.clone(), retry.clone());
    let first = retry_service
        .create(request(retry_id, TerminalLaunchKind::Task))
        .await
        .unwrap_err();
    assert_eq!(first.code_str(), "terminal_runtime_unavailable");
    assert_eq!(effect_state(&database, retry_id).await, "prepared");

    let settled = retry_service
        .create(request(retry_id, TerminalLaunchKind::Task))
        .await
        .unwrap();
    assert_eq!(*retry.attempts.lock().unwrap(), 2);
    assert_eq!(effect_state(&database, retry_id).await, "applied");
    assert_eq!(
        run_count(&database, "agent_terminal_sessions", retry_id).await,
        1
    );
    assert_eq!(status_count(&database, retry_id).await, 2);
    assert_eq!(settled.agent_run_id, run_id(&database, retry_id).await);
}

async fn count(database: &sea_orm::DatabaseConnection, table: &str) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) AS value FROM {table}"),
        "value",
    )
    .await
}

async fn expire_launch_leases(database: &sea_orm::DatabaseConnection) {
    database
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE runs_launch_effects SET lease_expires_at='2000-01-01 00:00:00.000000' WHERE state='leased'"
                .to_owned(),
        ))
        .await
        .unwrap();
}

async fn request_count(
    database: &sea_orm::DatabaseConnection,
    table: &str,
    request_id: &str,
) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) AS value FROM {table} WHERE request_id='{request_id}'"),
        "value",
    )
    .await
}

async fn run_count(database: &sea_orm::DatabaseConnection, table: &str, request_id: &str) -> i64 {
    scalar(
        database,
        &format!(
            "SELECT COUNT(*) AS value FROM {table} WHERE {}=(SELECT agent_run_id FROM runs_launch_effects WHERE request_id='{request_id}')",
            if table == "agent_runs" { "id" } else { "agent_run_id" }
        ),
        "value",
    )
    .await
}

async fn status_count(database: &sea_orm::DatabaseConnection, request_id: &str) -> i64 {
    scalar(
        database,
        &format!(
            "SELECT COUNT(*) AS value FROM runs_status_events WHERE agent_run_id=(SELECT agent_run_id FROM runs_launch_effects WHERE request_id='{request_id}')"
        ),
        "value",
    )
    .await
}

async fn effect_state(database: &sea_orm::DatabaseConnection, request_id: &str) -> String {
    scalar(
        database,
        &format!("SELECT state AS value FROM runs_launch_effects WHERE request_id='{request_id}'"),
        "value",
    )
    .await
}

#[tokio::test]
async fn an_uncomposed_authority_refuses_agent_launches_and_still_serves_shells() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(RecordingRuntime::new(database.clone()));
    // No authority: nothing can resolve what this launch may run with, and a
    // caller-supplied provider, model, and prompt are not an answer.
    let service = TerminalLaunchService::new(database.clone(), runtime.clone());
    let before_material = count(&database, "terminal_launch_material").await;

    for kind in [
        TerminalLaunchKind::Task,
        TerminalLaunchKind::Planning,
        TerminalLaunchKind::Instant,
    ] {
        let error = service
            .create(request("uncomposed-authority", kind))
            .await
            .unwrap_err();
        assert_eq!(error.code_str(), "terminal_runtime_unavailable");
    }
    assert_eq!(
        count(&database, "terminal_launch_material").await,
        before_material
    );

    // A shell carries no agent material, so it is unaffected.
    service
        .create_module_shell(
            "uncomposed-authority-shell".to_owned(),
            MODULE_ID.to_owned(),
            80,
            24,
        )
        .await
        .expect("a module shell needs no launch authority");
}

async fn run_id(database: &sea_orm::DatabaseConnection, request_id: &str) -> String {
    scalar(
        database,
        &format!(
            "SELECT agent_run_id AS value FROM runs_launch_effects WHERE request_id='{request_id}'"
        ),
        "value",
    )
    .await
}

async fn scalar<T>(database: &sea_orm::DatabaseConnection, sql: &str, column: &str) -> T
where
    T: sea_orm::TryGetable,
{
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .unwrap()
        .unwrap()
        .try_get("", column)
        .unwrap()
}
