mod common;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::submitted_launch_authority::launch_service;
use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID,
};
use muxed_studio_lib::entities::{runs::agent_run, terminals::launch_material};
use muxed_studio_lib::execution::graph::{ExecutionMode, GraphAccess};
use muxed_studio_lib::execution::reconciliation::ExecutionReconciliationService;
use muxed_studio_lib::graph_run_service::GraphRunCaller;
use muxed_studio_lib::graph_run_service::{GraphRunRequest, GraphRunService};
use muxed_studio_lib::terminal::launch::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchError, TerminalLaunchRuntime,
    TerminalLaunchService, TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use muxed_studio_lib::work_management::launch_policy::LaunchPolicyResolver;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use seaography::{Builder, BuilderContext};

const CHILD_A: &str = "00000000000000000000000000008951";
const CHILD_B: &str = "00000000000000000000000000008952";
const BLOCKED: &str = "00000000000000000000000000008953";
const READY: &str = "00000000000000000000000000008954";
const EXTERNAL: &str = "00000000000000000000000000008955";
const REVIEW: &str = "00000000000000000000000000008956";
const PROVIDER: &str = "00000000000000000000000000008957";
const MODEL: &str = "00000000000000000000000000008958";
const INVALID_ROOT: &str = "00000000000000000000000000000001";

#[derive(Default)]
struct Runtime {
    created: Mutex<HashSet<String>>,
}

#[async_trait]
impl TerminalLaunchRuntime for Runtime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.created.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("graph-{agent_run_id}"),
                runtime_namespace: "graph-run-test".to_owned(),
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
        self.created
            .lock()
            .unwrap()
            .insert(material.agent_run_id.clone());
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await?;
        Ok(())
    }
}

#[tokio::test]
async fn create_press_policy_refresh_inert_success_and_reset_are_serialized() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let request = |mode| GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::caller_roots(PROJECT_ID, [TASK_ID]),
        mode,
        provider_override: None,
    };

    database
        .execute_unprepared("UPDATE worktracker_launchbinding SET subtree_run_enabled=0")
        .await
        .unwrap();
    let refused = service.create_or_press(request(None)).await.unwrap_err();
    assert_eq!(refused.code_str(), "subtree_run_not_enabled");
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM graph_runs").await,
        0
    );
    database
        .execute_unprepared("UPDATE worktracker_launchbinding SET subtree_run_enabled=1")
        .await
        .unwrap();

    let first = service.create_or_press(request(None)).await.unwrap();
    assert_eq!(first.graph_run.execution_mode, "parallel");
    assert_eq!(task_ids(&first), [CHILD_A, CHILD_B]);
    let child_a_prompt = launch_prompt(&database, CHILD_A).await;
    assert!(child_a_prompt
        .starts_with("Selected workflow prompt:\nInitial policy.\n\nWork item context (factual):"));
    assert!(child_a_prompt.contains("Description:\nChild A launch details."));
    let claims_before = claim_runs(&database).await;

    let repeated = service.create_or_press(request(None)).await.unwrap();
    assert!(repeated.launched.is_empty());
    assert_eq!(claim_runs(&database).await, claims_before);

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{CHILD_A}'; \
             UPDATE agent_runs SET ended_at='2026-08-19T14:00:00Z' WHERE issue_id='{CHILD_B}'; \
             UPDATE agent_terminal_sessions SET terminated_at='2026-08-19T14:00:00Z' WHERE task_id='{CHILD_B}'; \
             UPDATE worktracker_launchbinding SET prompt='Refreshed policy.'"
        ))
        .await
        .unwrap();
    let refreshed = service
        .create_or_press(request(Some(ExecutionMode::Serial)))
        .await
        .unwrap();
    assert_eq!(task_ids(&refreshed), [CHILD_B]);
    assert_eq!(refreshed.graph_run.execution_mode, "serial");
    assert!(refreshed
        .graph_run
        .launch_configuration
        .as_deref()
        .unwrap()
        .contains("Refreshed policy."));
    let claims_after = claim_runs(&database).await;
    assert_eq!(claims_after[CHILD_A], claims_before[CHILD_A]);
    assert_ne!(claims_after[CHILD_B], claims_before[CHILD_B]);

    let inert = service
        .create_or_press(request(Some(ExecutionMode::Serial)))
        .await
        .unwrap();
    assert!(inert.launched.is_empty());

    let live_runs = scalar(&database, "SELECT COUNT(*) FROM agent_runs").await;
    let live_sessions = scalar(&database, "SELECT COUNT(*) FROM agent_terminal_sessions").await;
    let reset = service
        .reset(TASK_ID, &GraphAccess::caller_roots(PROJECT_ID, [TASK_ID]))
        .await
        .unwrap();
    assert_eq!(reset.cleared_task_ids, [CHILD_A, CHILD_B]);
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM graph_runs").await,
        0
    );
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        0
    );
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM agent_runs").await,
        live_runs
    );
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM agent_terminal_sessions").await,
        live_sessions
    );
}

#[tokio::test]
async fn graph_run_graphql_contract_returns_authoritative_models_and_child_ids() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    let service = service(&database);
    let context = Box::leak(Box::new(BuilderContext::default()));
    let builder = muxed_studio_lib::entities::work_management::register_entity_modules(
        Builder::new(context, database.clone()),
    );
    let mut builder = muxed_studio_lib::entities::execution::register_entity_modules(builder);
    seaography::register_entity!(builder, agent_run, mutation: false);
    let schema = muxed_studio_lib::execution::graph_run::register_graphql(builder)
        .schema_builder()
        .data(database.clone())
        .data(service)
        .data(GraphRunCaller)
        .finish()
        .unwrap();

    let missing_update = serde_json::to_value(
        schema
            .execute(format!(
                "mutation {{ graph_run_update(root_id: \"{TASK_ID}\") {{ graph_run {{ rootId }} }} }}"
            ))
            .await,
    )
    .unwrap();
    assert_eq!(
        missing_update["errors"][0]["extensions"]["code"],
        "graph_run_not_found"
    );

    let created = schema
        .execute(format!(
            "mutation {{ graph_run_create(root_id: \"{TASK_ID}\", execution_mode: \"serial\") {{ graph_run {{ rootId executionMode }} prepared_child_ids }} }}"
        ))
        .await;
    assert!(created.errors.is_empty(), "{:?}", created.errors);
    let created = created.data.into_json().unwrap();
    assert_eq!(
        created["graph_run_create"]["graph_run"]["rootId"],
        compact(TASK_ID)
    );
    assert_eq!(
        created["graph_run_create"]["graph_run"]["executionMode"],
        "serial"
    );
    assert_eq!(
        created["graph_run_create"]["prepared_child_ids"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let duplicate_create = serde_json::to_value(
        schema
            .execute(format!(
                "mutation {{ graph_run_create(root_id: \"{TASK_ID}\") {{ graph_run {{ rootId }} }} }}"
            ))
            .await,
    )
    .unwrap();
    assert_eq!(
        duplicate_create["errors"][0]["extensions"]["code"],
        "graph_run_already_exists"
    );

    let updated = schema
        .execute(format!(
            "mutation {{ graph_run_update(root_id: \"{TASK_ID}\", execution_mode: \"parallel\") {{ graph_run {{ rootId executionMode }} prepared_child_ids }} }}"
        ))
        .await;
    assert!(updated.errors.is_empty(), "{:?}", updated.errors);
    let updated = updated.data.into_json().unwrap();
    assert_eq!(
        updated["graph_run_update"]["graph_run"]["executionMode"],
        "parallel"
    );

    let deleted = schema
        .execute(format!(
            "mutation {{ graph_run_delete(root_id: \"{TASK_ID}\") {{ graph_run {{ rootId executionMode }} cleared_child_ids }} }}"
        ))
        .await;
    assert!(deleted.errors.is_empty(), "{:?}", deleted.errors);
    let deleted = deleted.data.into_json().unwrap();
    assert_eq!(
        deleted["graph_run_delete"]["graph_run"]["rootId"],
        compact(TASK_ID)
    );
    assert!(!deleted["graph_run_delete"]["cleared_child_ids"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM graph_runs").await,
        0
    );
}

#[tokio::test]
async fn serial_skips_a_blocked_lower_child_and_parallel_press_races_launch_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_A}','{CHILD_B}'); \
             INSERT INTO worktracker_issue_blocked_by(from_issue_id,to_issue_id) VALUES ('{BLOCKED}','{EXTERNAL}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let serial = service
        .create_or_press(GraphRunRequest {
            root_id: TASK_ID.to_owned(),
            access: GraphAccess::project(PROJECT_ID),
            mode: Some(ExecutionMode::Serial),
            provider_override: None,
        })
        .await
        .unwrap();
    assert_eq!(task_ids(&serial), [READY]);

    service
        .reset(TASK_ID, &GraphAccess::project(PROJECT_ID))
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET ended_at='ended' WHERE issue_id='{READY}'; \
             UPDATE agent_terminal_sessions SET terminated_at='ended' WHERE task_id='{READY}'; \
             DELETE FROM worktracker_issue_blocked_by WHERE from_issue_id='{BLOCKED}'"
        ))
        .await
        .unwrap();
    let call = || GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode: Some(ExecutionMode::Parallel),
        provider_override: None,
    };
    let (left, right) = tokio::join!(
        service.create_or_press(call()),
        service.create_or_press(call())
    );
    assert!(left.is_ok() || right.is_ok());
    assert_eq!(
        scalar_where(&database, "agent_runs", "issue_id", BLOCKED).await,
        1
    );

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=0 WHERE id='{CHILD_A}'"
        ))
        .await
        .unwrap();
    let reset_access = GraphAccess::project(PROJECT_ID);
    let (press, reset) = tokio::join!(
        service.create_or_press(call()),
        service.reset(TASK_ID, &reset_access)
    );
    assert!(press.is_ok() || reset.is_ok());
    if scalar(&database, "SELECT COUNT(*) FROM graph_runs").await == 0 {
        assert_eq!(
            scalar(
                &database,
                &format!(
                    "SELECT COUNT(*) FROM launched_tasks WHERE root_id='{}'",
                    compact(TASK_ID)
                )
            )
            .await,
            0,
            "reset must not leave a claim prepared after its header disappeared"
        );
    }
}

#[tokio::test]
async fn committed_claim_survives_a_stopped_response_and_reconciles_the_same_generation() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_B}','{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let runtime = Arc::new(Runtime::default());
    let before_commit = launch_service(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::MaterialPrepared);
    let before_commit_service = service_with_terminal(&database, before_commit);
    let request = GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode: Some(ExecutionMode::Parallel),
        provider_override: None,
    };
    let stopped = before_commit_service
        .create_or_press(request.clone())
        .await
        .unwrap_err();
    assert_eq!(stopped.code_str(), "terminal_launch_injected_stop");
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        0
    );
    assert_eq!(
        scalar_where(&database, "agent_runs", "issue_id", CHILD_A).await,
        0
    );

    let terminal = launch_service(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::EffectPrepared);
    let service = service_with_terminal(&database, terminal.clone());

    let stopped = service.create_or_press(request.clone()).await.unwrap_err();
    assert_eq!(stopped.code_str(), "terminal_launch_injected_stop");
    let before = claim_tuple(&database, CHILD_A).await;
    assert_eq!(before.3, 1);
    assert_eq!(
        scalar_where(&database, "agent_runs", "issue_id", CHILD_A).await,
        1
    );
    assert_eq!(runtime.created.lock().unwrap().len(), 0);

    terminal.reconcile().await.unwrap();
    terminal.reconcile().await.unwrap();
    let replay = service.create_or_press(request).await.unwrap();
    assert!(replay.launched.is_empty());
    assert_eq!(claim_tuple(&database, CHILD_A).await, before);
    assert_eq!(runtime.created.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn deliberate_retry_requires_settled_cleanup_and_reuses_the_child_claim() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_B}','{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let request = GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode: Some(ExecutionMode::Parallel),
        provider_override: None,
    };
    service.create_or_press(request.clone()).await.unwrap();
    let first = claim_tuple(&database, CHILD_A).await;
    database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET ended_at='2026-08-19 18:00:00', status='failed' WHERE id='{}'; \
             UPDATE agent_terminal_sessions SET terminated_at='2026-08-19 18:00:00' WHERE agent_run_id='{}'; \
             UPDATE runs_launch_effects SET state='cleanup_pending', applied_at=NULL, last_error_code='terminal_runtime_unavailable' WHERE effect_id='{}'",
            first.1, first.1, first.2
        ))
        .await
        .unwrap();

    let blocked = service.create_or_press(request.clone()).await.unwrap_err();
    assert_eq!(blocked.code_str(), "terminal_launch_conflict");
    assert_eq!(claim_tuple(&database, CHILD_A).await, first);

    database
        .execute_unprepared(&format!(
            "UPDATE runs_launch_effects SET state='failed', runtime_evidence='{{\"cleanup\":\"complete\"}}' WHERE effect_id='{}'",
            first.2
        ))
        .await
        .unwrap();
    let retried = service.create_or_press(request.clone()).await.unwrap();
    assert_eq!(task_ids(&retried), [CHILD_A]);
    let second = claim_tuple(&database, CHILD_A).await;
    assert_eq!(second.3, 2);
    assert_ne!(second.0, first.0);
    assert_ne!(second.1, first.1);
    assert_ne!(second.2, first.2);

    database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET ended_at='2026-08-19 19:00:00', status='failed' WHERE id='{}'; \
             UPDATE agent_terminal_sessions SET terminated_at='2026-08-19 19:00:00' WHERE agent_run_id='{}'; \
             UPDATE runs_launch_effects SET state='failed', applied_at=NULL, last_error_code='terminal_runtime_identity_conflict' WHERE effect_id='{}'",
            second.1, second.1, second.2
        ))
        .await
        .unwrap();
    let conflicted = service.create_or_press(request).await.unwrap_err();
    assert_eq!(conflicted.code_str(), "terminal_launch_conflict");
    assert_eq!(claim_tuple(&database, CHILD_A).await, second);
}

#[tokio::test]
async fn serial_advancement_treats_satisfaction_and_termination_as_symmetric_facts() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let first_service = service(&database);
    let request = GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode: Some(ExecutionMode::Serial),
        provider_override: None,
    };
    let first = first_service.create_or_press(request).await.unwrap();
    assert_eq!(task_ids(&first), [CHILD_A]);
    let claim = claim_tuple(&database, CHILD_A).await;

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{CHILD_A}'"
        ))
        .await
        .unwrap();
    let satisfied_first = first_service.advance(TASK_ID).await.unwrap();
    assert!(satisfied_first.launched.is_empty());
    assert!(satisfied_first.terminal_reconciliation_requested);

    database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET ended_at='ended' WHERE id='{}'; \
             UPDATE agent_terminal_sessions SET terminated_at='ended' WHERE agent_run_id='{}'",
            claim.1, claim.1
        ))
        .await
        .unwrap();
    let terminated_second = first_service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        terminated_second
            .launched
            .iter()
            .map(|child| child.task_id.as_str())
            .collect::<Vec<_>>(),
        [CHILD_B]
    );
    let child_b_prompt = launch_prompt(&database, CHILD_B).await;
    assert!(child_b_prompt
        .starts_with("Selected workflow prompt:\nInitial policy.\n\nWork item context (factual):"));
    assert!(child_b_prompt.contains("Description:\nChild B launch details."));
    drop(first_service);
    drop(database);
    drop(harness);

    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let first = service
        .create_or_press(GraphRunRequest {
            root_id: TASK_ID.to_owned(),
            access: GraphAccess::project(PROJECT_ID),
            mode: Some(ExecutionMode::Serial),
            provider_override: None,
        })
        .await
        .unwrap();
    let claim = claim_tuple(&database, CHILD_A).await;
    assert_eq!(task_ids(&first), [CHILD_A]);
    database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET ended_at='ended' WHERE id='{}'; \
             UPDATE agent_terminal_sessions SET terminated_at='ended' WHERE agent_run_id='{}'",
            claim.1, claim.1
        ))
        .await
        .unwrap();
    let ended_unsatisfied = service.advance(TASK_ID).await.unwrap();
    assert!(ended_unsatisfied.launched.is_empty());
    assert!(!ended_unsatisfied.terminal_reconciliation_requested);
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{CHILD_A}'"
        ))
        .await
        .unwrap();
    assert_eq!(service.advance(TASK_ID).await.unwrap().launched.len(), 1);
}

#[tokio::test]
async fn durable_external_blocker_event_advances_only_its_relevant_armed_root() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_A}','{CHILD_B}','{READY}'); \
             INSERT INTO worktracker_issue_blocked_by(from_issue_id,to_issue_id) VALUES ('{BLOCKED}','{EXTERNAL}')"
        ))
        .await
        .unwrap();
    let runtime = Arc::new(Runtime::default());
    let terminal = launch_service(database.clone(), runtime);
    let policy = LaunchPolicyResolver::new(database.clone());
    let graph_runs = GraphRunService::new(database.clone(), policy.clone(), terminal.clone());
    let armed = graph_runs
        .create_or_press(GraphRunRequest {
            root_id: TASK_ID.to_owned(),
            access: GraphAccess::project(PROJECT_ID),
            mode: Some(ExecutionMode::Parallel),
            provider_override: None,
        })
        .await
        .unwrap();
    assert!(armed.launched.is_empty());

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'"
        ))
        .await
        .unwrap();
    let reconciliation_service =
        ExecutionReconciliationService::new(database.clone(), policy, terminal);
    let reconciliation = reconciliation_service
        .reconcile_work_item(EXTERNAL, PROJECT_ID)
        .await;
    assert_eq!(reconciliation.roots.len(), 1);
    assert_eq!(reconciliation.roots[0].launched_task_ids, [BLOCKED]);

    let parallel_claim = claim_tuple(&database, BLOCKED).await;
    let termination_only = reconciliation_service
        .reconcile_agent_run(&parallel_claim.1)
        .await;
    assert!(termination_only.roots.is_empty());

    let duplicate = reconciliation_service
        .reconcile_work_item(EXTERNAL, PROJECT_ID)
        .await;
    assert!(duplicate.roots[0].launched_task_ids.is_empty());
}

#[tokio::test]
async fn an_invalid_armed_root_does_not_starve_a_later_ready_root() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_A}','{CHILD_B}','{READY}'); \
             INSERT INTO worktracker_issue_blocked_by(from_issue_id,to_issue_id) VALUES ('{BLOCKED}','{EXTERNAL}')"
        ))
        .await
        .unwrap();
    let terminal = launch_service(database.clone(), Arc::new(Runtime::default()));
    let policy = LaunchPolicyResolver::new(database.clone());
    GraphRunService::new(database.clone(), policy.clone(), terminal.clone())
        .create_or_press(GraphRunRequest {
            root_id: TASK_ID.to_owned(),
            access: GraphAccess::project(PROJECT_ID),
            mode: Some(ExecutionMode::Parallel),
            provider_override: None,
        })
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_issue \
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at) \
             SELECT '{INVALID_ROOT}',project_id,'task',issue_type_id,parent_id,module_id,state_id,0,'Invalid archived root',999999,1,'bad','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP \
             FROM worktracker_issue WHERE id='{}'; \
             INSERT INTO graph_runs(root_id,agent,created_at,updated_at,module_id,project_id,execution_mode,launch_configuration) \
             SELECT '{INVALID_ROOT}',agent,created_at,updated_at,module_id,project_id,execution_mode,launch_configuration \
             FROM graph_runs WHERE root_id='{}'; \
             UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'",
            compact(TASK_ID), compact(TASK_ID)
        ))
        .await
        .unwrap();

    let report = ExecutionReconciliationService::new(database, policy, terminal)
        .reconcile_armed_batch(None, 128)
        .await;
    assert_eq!(report.roots.len(), 2);
    assert!(report.roots[0].error.is_some());
    assert_eq!(report.roots[1].launched_task_ids, [BLOCKED]);
}

fn service(database: &DatabaseConnection) -> GraphRunService {
    let policy = LaunchPolicyResolver::new(database.clone());
    let terminal = launch_service(database.clone(), Arc::new(Runtime::default()));
    GraphRunService::new(database.clone(), policy, terminal)
}

fn service_with_terminal(
    database: &DatabaseConnection,
    terminal: TerminalLaunchService,
) -> GraphRunService {
    let policy = LaunchPolicyResolver::new(database.clone());
    GraphRunService::new(database.clone(), policy, terminal)
}

async fn seed(database: &DatabaseConnection, directory: &std::path::Path) {
    let compact_project = compact(PROJECT_ID);
    let compact_module = compact(MODULE_ID);
    let compact_root = compact(TASK_ID);
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_state
                (id,project_id,name,"group",color,sort_order,is_protected,created_at,updated_at)
                VALUES ('{REVIEW}','{compact_project}','Review','started','',99,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{CHILD_A}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Child A',9001,0,'a','<p>Child A launch details.</p>',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{CHILD_B}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Child B',9002,0,'b','<p>Child B launch details.</p>',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{BLOCKED}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Blocked',9003,0,'c','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{READY}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Ready',9004,0,'d','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{EXTERNAL}',project_id,'task',issue_type_id,'{compact_module}','{compact_module}',state_id,0,'External',9005,0,'e','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT OR IGNORE INTO worktracker_provider(id,slug,activated,supports_unattended)
                VALUES ('{PROVIDER}','codex',1,1);
            INSERT OR IGNORE INTO worktracker_agentmodel(id,provider_id,name)
                SELECT '{MODEL}',id,'graph-run-test-model' FROM worktracker_provider WHERE slug='codex' LIMIT 1;
            DELETE FROM worktracker_launchbinding WHERE issue_type_id=(SELECT issue_type_id FROM worktracker_issue WHERE id='{compact_root}');
            INSERT INTO worktracker_launchbinding
                (issue_type_id,state_id,prompt,required_skills,model_id,reasoning_id,auto_start,subtree_run_enabled,created_at,updated_at)
                SELECT issue_type_id,state_id,'Initial policy.','[]','{MODEL}',NULL,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
                FROM worktracker_issue WHERE id='{compact_root}';
            INSERT OR REPLACE INTO app_settings(scope,"key",value,updated_at)
                VALUES ('host','provider_catalog','{{"global_default":{{"provider":"codex","model":"graph-run-test-model","reasoning":null}}}}',CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    std::fs::write(
        directory.join("profiles.json"),
        r#"{"recent_profile_index":0,"profiles":[{"name":"Local","workspace_slug":"terminal-harness"}]}"#,
    )
    .unwrap();
    // The folder a graph run launches in is the Module's typed link. The
    // profile above still decides which workspace may launch at all.
    muxed_studio_lib::module_links::schema::install(database)
        .await
        .unwrap();
    muxed_studio_lib::module_links::ModuleLinkStore::new(database.clone())
        .set(&compact_module, &directory.display().to_string())
        .await
        .expect("link the harness module");
}

fn task_ids(result: &muxed_studio_lib::graph_run_service::GraphRunResult) -> Vec<&str> {
    result
        .launched
        .iter()
        .map(|row| row.task_id.as_str())
        .collect()
}

async fn claim_runs(database: &DatabaseConnection) -> std::collections::HashMap<String, String> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT task_id, agent_run_id FROM launched_tasks ORDER BY task_id".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "task_id").unwrap(),
                row.try_get("", "agent_run_id").unwrap(),
            )
        })
        .collect()
}

async fn launch_prompt(database: &DatabaseConnection, task_id: &str) -> String {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT prompt FROM terminal_launch_material WHERE task_id='{task_id}' ORDER BY created_at DESC LIMIT 1"
            ),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "prompt")
        .unwrap()
}

async fn claim_tuple(
    database: &DatabaseConnection,
    child_id: &str,
) -> (String, String, String, i64) {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT claim_id, agent_run_id, launch_effect_id, launch_generation FROM launched_tasks WHERE task_id='{child_id}'"),
        ))
        .await
        .unwrap()
        .unwrap();
    (
        row.try_get("", "claim_id").unwrap(),
        row.try_get("", "agent_run_id").unwrap(),
        row.try_get("", "launch_effect_id").unwrap(),
        row.try_get("", "launch_generation").unwrap(),
    )
}

async fn scalar(database: &DatabaseConnection, sql: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .unwrap()
        .unwrap()
        .try_get_by_index(0)
        .unwrap()
}

async fn scalar_where(
    database: &DatabaseConnection,
    table: &str,
    column: &str,
    value: &str,
) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) FROM {table} WHERE {column}='{value}'"),
    )
    .await
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value).unwrap().simple().to_string()
}
