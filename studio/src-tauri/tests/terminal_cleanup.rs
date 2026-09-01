mod common;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, PROJECT_ID, TASK_ID, TASK_RUN_ID,
};
use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
use ticketry_entities::{
    agent_run,
    {cleanup_effect, session},
};
use ticketry_terminal::{
    AuthenticatedAgentRun, CleanupCause, CleanupCheckpoint, CleanupCheckpoints, CleanupKillResult,
    CleanupRuntimeObservation, TerminalCleanupError, TerminalCleanupRuntime,
    TerminalCleanupService, TerminationPatch,
};

struct ScriptedRuntime {
    observations: Mutex<VecDeque<CleanupRuntimeObservation>>,
    kills: Mutex<Vec<CleanupKillResult>>,
}

impl ScriptedRuntime {
    fn new(observations: impl IntoIterator<Item = CleanupRuntimeObservation>) -> Self {
        Self {
            observations: Mutex::new(observations.into_iter().collect()),
            kills: Mutex::new(Vec::new()),
        }
    }

    fn kill_count(&self) -> usize {
        self.kills.lock().unwrap().len()
    }
}

#[async_trait]
impl TerminalCleanupRuntime for ScriptedRuntime {
    async fn inspect(&self, _: &session::Model) -> CleanupRuntimeObservation {
        self.observations
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(CleanupRuntimeObservation::Unavailable)
    }

    async fn kill_verified(&self, _: &session::Model) -> CleanupKillResult {
        let result = CleanupKillResult::Killed;
        self.kills.lock().unwrap().push(result);
        result
    }
}

struct StopOnce {
    target: CleanupCheckpoint,
    stopped: Mutex<bool>,
}

impl CleanupCheckpoints for StopOnce {
    fn reached(&self, checkpoint: CleanupCheckpoint) -> Result<(), TerminalCleanupError> {
        let mut stopped = self.stopped.lock().unwrap();
        if checkpoint == self.target && !*stopped {
            *stopped = true;
            Err(TerminalCleanupError::injected_checkpoint())
        } else {
            Ok(())
        }
    }
}

#[tokio::test]
async fn proved_absence_settles_terminal_run_status_and_effect_together() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::new([CleanupRuntimeObservation::Missing]));
    let service = TerminalCleanupService::new(database.clone(), runtime.clone());

    let terminal = service
        .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "explicit-1")
        .await
        .unwrap();

    assert!(terminal.terminated_at.is_some());
    assert!(!terminal.runtime_cleanup_pending);
    assert_eq!(runtime.kill_count(), 0, "absence must not spend a kill");
    let effect = cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.state, "applied");
    assert_eq!(effect.attempt_count, 1);
    assert!(effect.applied_at.is_some());
    assert!(effect
        .runtime_evidence
        .unwrap()
        .to_string()
        .contains("missing"));
    let run = agent_run::Entity::find_by_id(TASK_RUN_ID)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "terminated");
    assert!(run.ended_at.is_some());
    let replay = service
        .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "explicit-1")
        .await
        .unwrap();
    assert_eq!(replay.terminated_at, terminal.terminated_at);
}

#[tokio::test]
async fn verified_runtime_is_killed_then_proved_absent() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::new([
        CleanupRuntimeObservation::Running,
        CleanupRuntimeObservation::Missing,
    ]));
    let terminal = TerminalCleanupService::new(database, runtime.clone())
        .cleanup(TASK_RUN_ID, CleanupCause::HostedExit, "hosted-exit-1")
        .await
        .unwrap();
    assert!(terminal.terminated_at.is_some());
    assert_eq!(runtime.kill_count(), 1);
}

#[tokio::test]
async fn hosted_exit_cleanup_clears_pending_without_rewriting_the_observed_exit_time() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let observed_exit = "2026-08-23T20:00:00.000000Z";
    session::Entity::update_many()
        .col_expr(
            session::Column::TerminatedAt,
            Expr::value(Some(observed_exit.to_owned())),
        )
        .col_expr(session::Column::RuntimeCleanupPending, Expr::value(true))
        .filter(session::Column::AgentRunId.eq(TASK_RUN_ID))
        .exec(&database)
        .await
        .unwrap();
    let runtime = Arc::new(ScriptedRuntime::new([CleanupRuntimeObservation::Missing]));

    let terminal = TerminalCleanupService::new(database, runtime)
        .cleanup(TASK_RUN_ID, CleanupCause::HostedExit, TASK_RUN_ID)
        .await
        .unwrap();

    assert!(!terminal.runtime_cleanup_pending);
    assert_eq!(terminal.terminated_at.as_deref(), Some(observed_exit));
}

#[tokio::test]
async fn foreign_identity_conflicts_and_unavailable_inspection_stays_pending() {
    let foreign_harness = TerminalLifecycleHarness::start().await;
    let foreign_database = foreign_harness.database().await;
    let foreign_runtime = Arc::new(ScriptedRuntime::new([CleanupRuntimeObservation::Foreign]));
    let error = TerminalCleanupService::new(foreign_database.clone(), foreign_runtime.clone())
        .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "foreign-1")
        .await
        .unwrap_err();
    assert_eq!(error.code_str(), "terminal_runtime_identity_conflict");
    assert_eq!(foreign_runtime.kill_count(), 0);
    let foreign_effect = cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
        .one(&foreign_database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(foreign_effect.state, "conflict");
    assert_eq!(
        foreign_effect.last_error_code.as_deref(),
        Some("terminal_runtime_identity_conflict")
    );

    drop(foreign_harness);
    let pending_harness = TerminalLifecycleHarness::start().await;
    let pending_database = pending_harness.database().await;
    let pending_runtime = Arc::new(ScriptedRuntime::new([
        CleanupRuntimeObservation::Unavailable,
    ]));
    let error = TerminalCleanupService::new(pending_database.clone(), pending_runtime)
        .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "pending-1")
        .await
        .unwrap_err();
    assert_eq!(error.code_str(), "terminal_cleanup_pending");
    let pending_effect = cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
        .one(&pending_database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pending_effect.state, "cleanup_pending");
    assert!(pending_effect.lease_owner.is_none());
    assert_eq!(pending_effect.attempt_count, 1);
    assert_eq!(
        pending_effect.last_error_code.as_deref(),
        Some("terminal_runtime_unavailable")
    );
}

#[tokio::test]
async fn update_patch_and_mcp_principal_keep_termination_identity_bound() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::new([CleanupRuntimeObservation::Missing]));
    let service = TerminalCleanupService::new(database, runtime);
    let unchanged = service
        .update_terminal_session(TASK_RUN_ID, TerminationPatch::Omitted)
        .await
        .unwrap();
    assert!(unchanged.terminated_at.is_none());
    assert_eq!(
        service
            .update_terminal_session(TASK_RUN_ID, TerminationPatch::Null)
            .await
            .unwrap_err()
            .code_str(),
        "terminal_cleanup_invalid"
    );
    let foreign = AuthenticatedAgentRun {
        agent_run_id: TASK_RUN_ID.to_owned(),
        issue_id: TASK_ID.to_owned(),
        project_id: "foreign-project".to_owned(),
        scope: "task".to_owned(),
    };
    assert_eq!(
        service
            .terminate_current_run(&foreign, "mcp-foreign")
            .await
            .unwrap_err()
            .code_str(),
        "terminal_cleanup_invalid"
    );
    let current = AuthenticatedAgentRun {
        agent_run_id: TASK_RUN_ID.to_owned(),
        issue_id: TASK_ID.to_owned(),
        project_id: PROJECT_ID.to_owned(),
        scope: "task".to_owned(),
    };
    assert!(service
        .terminate_current_run(&current, "mcp-current")
        .await
        .unwrap()
        .terminated_at
        .is_some());
}

#[tokio::test]
async fn graphql_update_returns_the_authoritative_terminal_model() {
    let harness = TerminalLifecycleHarness::start().await;
    ticketry_settings::publish_readiness(
        harness.data_directory(),
        &ticketry_settings::Slice2Readiness::complete(),
    )
    .unwrap();
    let response = harness
        .graphql(
            r#"mutation Patch($run: String!) {
          terminal_session_update(agent_run_id: $run) {
            agentRunId terminatedAt
          }
        }"#,
            serde_json::json!({"run": TASK_RUN_ID}),
        )
        .await;
    assert_eq!(
        response["data"]["terminal_session_update"]["agentRunId"], TASK_RUN_ID,
        "{response}"
    );
    assert!(
        response["data"]["terminal_session_update"]["terminatedAt"].is_null(),
        "{response}"
    );
}

#[tokio::test]
async fn every_cleanup_crash_boundary_replays_without_reviving_or_duplicating_the_run() {
    for checkpoint in [
        CleanupCheckpoint::Preparation,
        CleanupCheckpoint::Claim,
        CleanupCheckpoint::Inspect,
        CleanupCheckpoint::Kill,
        CleanupCheckpoint::TerminalTombstone,
        CleanupCheckpoint::RunFact,
        CleanupCheckpoint::StatusAppend,
        CleanupCheckpoint::Settlement,
        CleanupCheckpoint::Response,
    ] {
        let harness = TerminalLifecycleHarness::start().await;
        let database = harness.database().await;
        let runtime = Arc::new(ScriptedRuntime::new([
            CleanupRuntimeObservation::Running,
            CleanupRuntimeObservation::Missing,
            CleanupRuntimeObservation::Missing,
        ]));
        let stopped = TerminalCleanupService::new(database.clone(), runtime.clone())
            .with_checkpoints(Arc::new(StopOnce {
                target: checkpoint,
                stopped: Mutex::new(false),
            }))
            .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "crash-replay")
            .await;
        assert!(stopped.is_err(), "checkpoint {checkpoint:?} did not stop");

        let effect = cleanup_effect::Entity::find()
            .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        if effect.state == "leased" {
            cleanup_effect::Entity::update_many()
                .col_expr(
                    cleanup_effect::Column::LeaseExpiresAt,
                    Expr::value(Some("2000-01-01T00:00:00.000000Z".to_owned())),
                )
                .filter(cleanup_effect::Column::EffectId.eq(&effect.effect_id))
                .exec(&database)
                .await
                .unwrap();
        }

        let settled = TerminalCleanupService::new(database.clone(), runtime)
            .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "crash-replay")
            .await
            .unwrap();
        assert!(settled.terminated_at.is_some(), "checkpoint {checkpoint:?}");
        let run = agent_run::Entity::find_by_id(TASK_RUN_ID)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.status, "terminated", "checkpoint {checkpoint:?}");
        let settled_effect = cleanup_effect::Entity::find_by_id(effect.effect_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(settled_effect.state, "applied", "checkpoint {checkpoint:?}");
        let terminal_events = ticketry_entities::status_event::Entity::find()
            .filter(ticketry_entities::status_event::Column::AgentRunId.eq(TASK_RUN_ID))
            .filter(
                ticketry_entities::status_event::Column::EventKind.eq("agent_run.terminal"),
            )
            .count(&database)
            .await
            .unwrap();
        assert_eq!(terminal_events, 1, "checkpoint {checkpoint:?}");
    }
}
