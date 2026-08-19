//! Prepared launch effects with predetermined AgentRun identities.
//!
//! These cases assert what an operator or supported capability can observe
//! after a command, a rollback, a duplicate delivery, or a lease boundary:
//! zero terminal launch for a rolled-back preparation, and exactly one
//! deterministic runtime for one prepared effect.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use muxed_studio_lib::runs_persistence::{
    adopt, ClaimedLaunch, LaunchExecutor, LaunchExecutorFailure, LaunchIntent, LaunchOutcome,
    LaunchRuntimeEvidence, PrepareLaunchRequest, RunSnapshot, RunsPersistenceErrorCode,
    RunsServices, TransitionOccurrence,
};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

const PROVIDER: &str = "codex";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn fixture(path: &Path) {
    let script = r#"
import os, sys, uuid
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id=uuid.UUID(int=800),slug='launch-fixture',name='Launch Fixture')
for base in (800, 810):
    project=Project.objects.create(id=uuid.UUID(int=base+1),workspace=w,name=f'Project {base}',slug=f'P{base}')
    state=State.objects.create(id=uuid.UUID(int=base+2),project=project,name='Todo',group='unstarted',sort_order=1)
    kind=IssueType.objects.create(id=uuid.UUID(int=base+3),project=project,name='Story',level='task',sort_order=1,start_state=state)
    Issue.objects.create(id=uuid.UUID(int=base+4),project=project,type='task',issue_type=kind,state=state,name='Launch fixture',sequence_id=base,rank='z')
"#;
    let output = Command::new(root().join("backend/.venv/bin/python"))
        .arg("-c")
        .arg(script)
        .arg(path)
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn adopted() -> (tempfile::TempDir, sea_orm::DatabaseConnection, RunsServices) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    adopt(directory.path()).await.unwrap();
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    let services = RunsServices::new(database.clone());
    (directory, database, services)
}

fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).hyphenated().to_string()
}

/// One launch identity tuple. Every field except `attempt` is predetermined by
/// the caller before any side effect exists.
fn intent(seed: u128, base: u128, attempt: Option<String>) -> LaunchIntent {
    LaunchIntent {
        effect_id: id(seed),
        agent_run_id: format!("run-{seed}"),
        automation_attempt_id: attempt,
        request_id: format!("request-{seed}"),
        project_id: id(base + 1),
        issue_id: id(base + 4),
        scope: "task".to_owned(),
        provider: PROVIDER.to_owned(),
        target_kind: "task".to_owned(),
        target_id: id(base + 4),
        policy_reference: None,
    }
}

fn request(intent: LaunchIntent) -> PrepareLaunchRequest {
    PrepareLaunchRequest {
        intent,
        snapshot: RunSnapshot {
            model: Some("gpt-5".to_owned()),
            ..RunSnapshot::default()
        },
    }
}

async fn count(database: &sea_orm::DatabaseConnection, table: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap()
}

/// Stands in for the temporary Python terminal capability. It records exactly
/// what crossed the compatibility port and can never reach a Runs table.
#[derive(Clone)]
struct RecordingExecutor {
    claims: Arc<Mutex<Vec<ClaimedLaunch>>>,
    failure: Option<LaunchExecutorFailure>,
}

impl RecordingExecutor {
    fn succeeding() -> Self {
        Self {
            claims: Arc::new(Mutex::new(Vec::new())),
            failure: None,
        }
    }

    fn failing(retryable: bool, cleanup_confirmed: bool) -> Self {
        Self {
            claims: Arc::new(Mutex::new(Vec::new())),
            failure: Some(LaunchExecutorFailure {
                code: "provider_unavailable".to_owned(),
                message: "The provider runtime refused the launch.".to_owned(),
                retryable,
                cleanup_confirmed,
            }),
        }
    }

    fn claims(&self) -> Vec<ClaimedLaunch> {
        self.claims.lock().unwrap().clone()
    }
}

#[async_trait]
impl LaunchExecutor for RecordingExecutor {
    async fn execute(
        &self,
        claim: ClaimedLaunch,
    ) -> Result<LaunchRuntimeEvidence, LaunchExecutorFailure> {
        self.claims.lock().unwrap().push(claim.clone());
        match &self.failure {
            Some(failure) => Err(failure.clone()),
            // The deterministic runtime identity is derived from the
            // predetermined run identity, which is all the executor received.
            None => Ok(LaunchRuntimeEvidence {
                runtime_id: format!("runtime-{}", claim.agent_run_id),
                adopted: false,
            }),
        }
    }
}

#[tokio::test]
async fn preparation_commits_run_effect_lifecycle_and_event_together() {
    let (_directory, database, services) = adopted().await;

    let prepared = services
        .effects()
        .prepare_launch(request(intent(900, 800, None)))
        .await
        .unwrap();

    assert!(!prepared.reused);
    assert_eq!(prepared.effect.state, "prepared");
    assert_eq!(prepared.effect.agent_run_id, "run-900");
    assert_eq!(prepared.effect.attempt_count, 0);
    assert!(prepared.effect.applied_at.is_none());

    let run = services
        .queries()
        .runs()
        .find("run-900")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "running");
    assert_eq!(run.lifecycle_state.as_deref(), Some("starting"));
    assert_eq!(run.lifecycle_updated_at, Some(run.started_at.clone()));
    assert_eq!(run.agent, PROVIDER);
    assert_eq!(run.model.as_deref(), Some("gpt-5"));

    // The launch is visible as authoritative status the moment it is durable,
    // before any terminal exists.
    let holdings = services
        .queries()
        .run_holdings(&id(801), None)
        .await
        .unwrap();
    assert_eq!(holdings.len(), 1);
    assert_eq!(holdings[0].state, "starting");
    assert_eq!(count(&database, "runs_status_events").await, 1);
}

#[tokio::test]
async fn rolled_back_preparation_exposes_nothing_and_wakes_no_executor() {
    let (_directory, database, services) = adopted().await;
    let executor = RecordingExecutor::succeeding();
    let dispatch = services.effects().dispatch_with(Arc::new(executor.clone()));

    database
        .execute_unprepared(
            "CREATE TRIGGER reject_effect BEFORE INSERT ON runs_launch_effects \
             BEGIN SELECT RAISE(ABORT, 'storage crash'); END",
        )
        .await
        .unwrap();

    assert!(dispatch
        .launch(request(intent(901, 800, None)))
        .await
        .is_err());

    assert_eq!(count(&database, "runs_launch_effects").await, 0);
    assert_eq!(count(&database, "agent_runs").await, 0);
    assert_eq!(count(&database, "runs_status_events").await, 0);
    assert!(
        executor.claims().is_empty(),
        "a rolled-back preparation can never wake the terminal executor"
    );
}

#[tokio::test]
async fn one_prepared_effect_produces_exactly_one_deterministic_runtime() {
    let (_directory, database, services) = adopted().await;
    let executor = RecordingExecutor::succeeding();
    let dispatch = services.effects().dispatch_with(Arc::new(executor.clone()));

    let first = dispatch
        .launch(request(intent(902, 800, None)))
        .await
        .unwrap();
    assert!(first.settled);
    assert_eq!(first.effect.state, "applied");
    assert!(first.effect.applied_at.is_some());
    assert!(first.effect.lease_owner.is_none());
    assert_eq!(
        first.effect.runtime_evidence.as_deref(),
        Some(r#"{"adopted":false,"runtimeId":"runtime-run-902"}"#)
    );

    // The same transport request arriving twice is a retry, not a second
    // launch.
    let repeated = dispatch
        .launch(request(intent(902, 800, None)))
        .await
        .unwrap();
    assert!(!repeated.settled);
    assert_eq!(repeated.effect.effect_id, first.effect.effect_id);

    assert_eq!(executor.claims().len(), 1);
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
    assert_eq!(count(&database, "agent_runs").await, 1);
}

#[tokio::test]
async fn the_executor_receives_only_the_validated_effect_and_predetermined_run() {
    let (_directory, _database, services) = adopted().await;
    let executor = RecordingExecutor::succeeding();
    let dispatch = services.effects().dispatch_with(Arc::new(executor.clone()));

    dispatch
        .launch(request(intent(903, 800, None)))
        .await
        .unwrap();

    let claims = executor.claims();
    assert_eq!(claims.len(), 1);
    let claim = &claims[0];
    assert_eq!(
        claim.effect_id,
        uuid::Uuid::from_u128(903).simple().to_string()
    );
    assert_eq!(claim.agent_run_id, "run-903");
    assert_eq!(claim.lease_owner, dispatch.lease_owner());
    assert_eq!(claim.attempt_count, 1, "the claim is a durable attempt");
}

#[tokio::test]
async fn conflicting_reuse_of_a_launch_identity_returns_a_typed_conflict() {
    let (_directory, _database, services) = adopted().await;
    services
        .effects()
        .prepare_launch(request(intent(904, 800, None)))
        .await
        .unwrap();

    // Same effect identity, different target scope.
    let mut moved = intent(904, 800, None);
    moved.project_id = id(811);
    moved.issue_id = id(814);
    moved.target_id = id(814);
    assert_eq!(
        services
            .effects()
            .prepare_launch(request(moved))
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );

    // Same effect identity, different provider identity.
    let mut reprovisioned = intent(904, 800, None);
    reprovisioned.provider = "claude".to_owned();
    assert_eq!(
        services
            .effects()
            .prepare_launch(request(reprovisioned))
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );

    // A new effect identity may not steal an already-bound run or request.
    let mut restamped = intent(905, 800, None);
    restamped.agent_run_id = "run-904".to_owned();
    assert_eq!(
        services
            .effects()
            .prepare_launch(request(restamped))
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );

    // The launch intent must belong to the project that owns its WorkItem.
    let mut crossed = intent(906, 800, None);
    crossed.project_id = id(811);
    assert_eq!(
        services
            .effects()
            .prepare_launch(request(crossed))
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );
}

#[tokio::test]
async fn an_attempt_owns_one_tuple_while_retry_creates_a_distinct_one() {
    let (_directory, database, services) = adopted().await;
    let executor = RecordingExecutor::failing(true, true);
    let dispatch = services.effects().dispatch_with(Arc::new(executor.clone()));

    let attempt = services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: id(910),
            issue_id: id(804),
            project_id: id(801),
            from_state_id: id(802),
            to_state_id: id(802),
            workflow_revision: 7,
        })
        .await
        .unwrap();

    let failed = dispatch
        .launch(request(intent(911, 800, Some(attempt.attempt_id.clone()))))
        .await
        .unwrap();
    assert_eq!(failed.effect.state, "failed");
    assert_eq!(failed.attempt.as_ref().unwrap().status, "failed");

    // A second effect may not attach to the same Automation Attempt.
    assert_eq!(
        services
            .effects()
            .prepare_launch(request(intent(912, 800, Some(attempt.attempt_id.clone()))))
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );

    let retry = services
        .attempts()
        .retry(&attempt.attempt_id)
        .await
        .unwrap();
    assert_ne!(retry.attempt_id, attempt.attempt_id);
    let retried = dispatch
        .launch(request(intent(913, 800, Some(retry.attempt_id.clone()))))
        .await
        .unwrap();
    assert_eq!(retried.effect.agent_run_id, "run-913");

    // The failed original stays auditable beside its retry.
    assert_eq!(count(&database, "runs_launch_effects").await, 2);
    assert_eq!(count(&database, "agent_runs").await, 2);
    let original = services
        .queries()
        .attempts()
        .find(&attempt.attempt_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(original.status, "failed");
    assert_eq!(original.agent_run_id, None);
}

#[tokio::test]
async fn success_projects_the_applied_effect_onto_its_attempt_and_run() {
    let (_directory, _database, services) = adopted().await;
    let dispatch = services
        .effects()
        .dispatch_with(Arc::new(RecordingExecutor::succeeding()));

    let attempt = services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: id(920),
            issue_id: id(804),
            project_id: id(801),
            from_state_id: id(802),
            to_state_id: id(802),
            workflow_revision: 7,
        })
        .await
        .unwrap();
    let applied = dispatch
        .launch(request(intent(921, 800, Some(attempt.attempt_id.clone()))))
        .await
        .unwrap();

    let projected = applied.attempt.unwrap();
    assert_eq!(projected.status, "succeeded");
    assert_eq!(projected.agent_run_id.as_deref(), Some("run-921"));

    // A launched run is live, not terminal: only the provider ends it.
    let run = services
        .queries()
        .runs()
        .find("run-921")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "running");
    assert!(run.ended_at.is_none());
}

#[tokio::test]
async fn typed_failure_records_retryability_terminal_outcome_and_cleanup_state() {
    let (_directory, database, services) = adopted().await;
    let dispatch = services
        .effects()
        .dispatch_with(Arc::new(RecordingExecutor::failing(true, true)));

    let attempt = services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: id(930),
            issue_id: id(804),
            project_id: id(801),
            from_state_id: id(802),
            to_state_id: id(802),
            workflow_revision: 7,
        })
        .await
        .unwrap();
    let failed = dispatch
        .launch(request(intent(931, 800, Some(attempt.attempt_id.clone()))))
        .await
        .unwrap();

    assert_eq!(failed.effect.state, "failed");
    assert_eq!(
        failed.effect.last_error_code.as_deref(),
        Some("provider_unavailable")
    );
    assert!(failed.effect.lease_expires_at.is_none());
    let projected = failed.attempt.unwrap();
    assert_eq!(projected.status, "failed");
    assert!(projected.retryable);

    // A launch that produced no runtime makes its run terminal here; nothing
    // else will ever report an exit for it.
    let run = services
        .queries()
        .runs()
        .find("run-931")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "failed");
    assert!(run.ended_at.is_some());

    // Unconfirmed cleanup keeps the effect and its rows for reconciliation.
    let unconfirmed = services
        .effects()
        .dispatch_with(Arc::new(RecordingExecutor::failing(false, false)))
        .launch(request(intent(932, 800, None)))
        .await
        .unwrap();
    assert_eq!(unconfirmed.effect.state, "cleanup_pending");
    assert_eq!(count(&database, "agent_runs").await, 2);
    assert!(services
        .queries()
        .runs()
        .find("run-932")
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn claims_are_bounded_leases_that_only_one_executor_holds() {
    let (_directory, _database, services) = adopted().await;
    let prepared = services
        .effects()
        .prepare_launch(request(intent(940, 800, None)))
        .await
        .unwrap();
    let effect_id = prepared.effect.effect_id.clone();

    assert_eq!(
        services
            .effects()
            .claim(&effect_id, "owner-a", 0)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::InvalidLaunchIntent
    );
    assert_eq!(
        services
            .effects()
            .claim(&effect_id, "owner-a", 100_000)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::InvalidLaunchIntent
    );

    let held = services
        .effects()
        .claim(&effect_id, "owner-a", 600)
        .await
        .unwrap();
    assert_eq!(held.attempt_count, 1);
    assert_eq!(
        services
            .effects()
            .claim(&effect_id, "owner-b", 600)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );

    // Only the lease holder may report the outcome.
    assert_eq!(
        services
            .effects()
            .record_outcome(
                &effect_id,
                "owner-b",
                LaunchOutcome::Applied {
                    runtime_evidence: serde_json::json!({"runtimeId": "stolen"}),
                },
            )
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchLeaseNotHeld
    );

    services
        .effects()
        .record_outcome(
            &effect_id,
            "owner-a",
            LaunchOutcome::Applied {
                runtime_evidence: serde_json::json!({"runtimeId": "runtime-run-940"}),
            },
        )
        .await
        .unwrap();

    // A settled effect is never re-leased.
    assert_eq!(
        services
            .effects()
            .claim(&effect_id, "owner-c", 600)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::LaunchConflict
    );
}

#[tokio::test]
async fn an_expired_lease_becomes_claimable_without_a_second_run_identity() {
    let (_directory, database, services) = adopted().await;
    let prepared = services
        .effects()
        .prepare_launch(request(intent(950, 800, None)))
        .await
        .unwrap();
    let effect_id = prepared.effect.effect_id.clone();
    services
        .effects()
        .claim(&effect_id, "crashed-owner", 60)
        .await
        .unwrap();

    // Simulate the crashed owner's lease aging out.
    database
        .execute_unprepared("UPDATE runs_launch_effects SET lease_expires_at='2000-01-01 00:00:00'")
        .await
        .unwrap();

    let reclaimed = services
        .effects()
        .claim(&effect_id, "recovering-owner", 60)
        .await
        .unwrap();
    assert_eq!(reclaimed.agent_run_id, "run-950");
    assert_eq!(
        reclaimed.attempt_count, 2,
        "attempts are durable diagnostics across reclaim"
    );
    assert_eq!(count(&database, "agent_runs").await, 1);
}

#[tokio::test]
async fn contending_claims_settle_on_one_winner() {
    let (_directory, database, services) = adopted().await;
    let prepared = services
        .effects()
        .prepare_launch(request(intent(960, 800, None)))
        .await
        .unwrap();
    let effect_id = prepared.effect.effect_id.clone();

    let mut winners = 0;
    let contenders = (0..4).map(|index| {
        let services = services.clone();
        let effect_id = effect_id.clone();
        tokio::spawn(async move {
            services
                .effects()
                .claim(&effect_id, &format!("owner-{index}"), 600)
                .await
                .is_ok()
        })
    });
    for contender in contenders {
        if contender.await.unwrap() {
            winners += 1;
        }
    }
    assert_eq!(winners, 1, "a bounded lease admits exactly one executor");
    assert_eq!(count(&database, "runs_launch_effects").await, 1);
}

#[tokio::test]
async fn interactive_launches_stay_repeatable_through_new_request_identities() {
    let (_directory, database, services) = adopted().await;
    let executor = RecordingExecutor::succeeding();
    let dispatch = services.effects().dispatch_with(Arc::new(executor.clone()));

    // No Automation Attempt: an interactive launch is intentionally repeatable.
    dispatch
        .launch(request(intent(970, 800, None)))
        .await
        .unwrap();
    dispatch
        .launch(request(intent(971, 800, None)))
        .await
        .unwrap();

    assert_eq!(executor.claims().len(), 2);
    assert_eq!(count(&database, "runs_launch_effects").await, 2);
    assert_eq!(count(&database, "agent_runs").await, 2);
    assert_eq!(
        services
            .queries()
            .run_holdings(&id(801), None)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn a_contradicting_outcome_never_overwrites_a_settled_effect() {
    let (_directory, _database, services) = adopted().await;
    let dispatch = services
        .effects()
        .dispatch_with(Arc::new(RecordingExecutor::succeeding()));
    let applied = dispatch
        .launch(request(intent(980, 800, None)))
        .await
        .unwrap();

    let conflict = services
        .effects()
        .record_outcome(
            &applied.effect.effect_id,
            "any-owner",
            LaunchOutcome::Failed {
                code: "provider_unavailable".to_owned(),
                message: "late failure".to_owned(),
                retryable: true,
                cleanup_confirmed: true,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(conflict.code(), RunsPersistenceErrorCode::LaunchConflict);

    let effect = services
        .effects()
        .effects()
        .find(&applied.effect.effect_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "applied");
    assert!(effect.last_error_code.is_none());
}

#[tokio::test]
async fn launch_intent_never_carries_command_material() {
    let (_directory, _database, services) = adopted().await;
    // The durable record has no field for these, and unknown fields are
    // refused rather than ignored.
    for forbidden in ["command", "prompt", "token", "env", "executable"] {
        let payload = serde_json::json!({
            "effectId": id(990),
            "agentRunId": "run-990",
            "requestId": "request-990",
            "projectId": id(801),
            "issueId": id(804),
            "scope": "task",
            "provider": PROVIDER,
            "targetKind": "task",
            "targetId": id(804),
            forbidden: "rm -rf /",
        });
        assert!(
            LaunchIntent::from_json(&payload).is_err(),
            "{forbidden} must not reach a durable launch intent"
        );
    }

    let prepared = services
        .effects()
        .prepare_launch(request(intent(991, 800, None)))
        .await
        .unwrap();
    let stored = format!("{:?}", prepared.effect);
    assert!(!stored.contains("rm -rf"));
    assert!(prepared.effect.policy_reference.is_none());
}

/// Preparation validates an already-durable run identity instead of minting a
/// second one, and refuses to bind a launch to work that is over or to a run
/// that belongs elsewhere.
#[tokio::test]
async fn an_existing_predetermined_run_is_validated_rather_than_reminted() {
    let (_directory, database, services) = adopted().await;
    let seed = |id: &str, issue: u128, provider: &str, ended: &str| {
        format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, \
             lifecycle_state, lifecycle_updated_at, scope) VALUES \
             ('{id}', '{issue:032x}', '{provider}', 'running', '2026-01-01T00:00:00+00:00', \
             {ended}, 'starting', '2026-01-01T00:00:00+00:00', 'task')"
        )
    };
    database
        .execute_unprepared(&format!(
            "{}; {}; {};",
            seed("run-1000", 804, PROVIDER, "NULL"),
            seed("run-1001", 804, PROVIDER, "'2026-01-02T00:00:00+00:00'"),
            seed("run-1002", 814, PROVIDER, "NULL"),
        ))
        .await
        .unwrap();

    let mut adopted_run = intent(1000, 800, None);
    adopted_run.agent_run_id = "run-1000".to_owned();
    let prepared = services
        .effects()
        .prepare_launch(request(adopted_run))
        .await
        .unwrap();
    assert_eq!(prepared.effect.agent_run_id, "run-1000");
    assert_eq!(
        count(&database, "agent_runs").await,
        3,
        "no run was reminted"
    );
    let run = services
        .queries()
        .runs()
        .find("run-1000")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.started_at, "2026-01-01T00:00:00+00:00");

    for (seed_value, run_id) in [(1001u128, "run-1001"), (1002, "run-1002")] {
        let mut rebound = intent(seed_value, 800, None);
        rebound.agent_run_id = run_id.to_owned();
        assert_eq!(
            services
                .effects()
                .prepare_launch(request(rebound))
                .await
                .unwrap_err()
                .code(),
            RunsPersistenceErrorCode::LaunchConflict,
            "{run_id} must not be adopted by a new launch"
        );
    }
}
