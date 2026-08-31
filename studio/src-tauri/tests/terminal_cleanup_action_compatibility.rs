mod common;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, TASK_RUN_ID};
use muxed_studio_lib::terminal::cleanup::{
    CleanupCause, CleanupCheckpoint, CleanupCheckpoints, CleanupKillResult,
    CleanupRuntimeObservation, TerminalCleanupError, TerminalCleanupRuntime,
    TerminalCleanupService,
};
use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
};
use ticketry_entities::{
    runs::{agent_run, status_event},
    terminals::{cleanup_effect, session},
};

struct ScriptedRuntime {
    observations: Mutex<VecDeque<CleanupRuntimeObservation>>,
    kills: Mutex<usize>,
}

impl ScriptedRuntime {
    fn new(observations: impl IntoIterator<Item = CleanupRuntimeObservation>) -> Self {
        Self {
            observations: Mutex::new(observations.into_iter().collect()),
            kills: Mutex::new(0),
        }
    }

    fn kill_count(&self) -> usize {
        *self.kills.lock().unwrap()
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
        *self.kills.lock().unwrap() += 1;
        CleanupKillResult::Killed
    }
}

struct StopOnce(CleanupCheckpoint, Mutex<bool>);

impl CleanupCheckpoints for StopOnce {
    fn reached(&self, checkpoint: CleanupCheckpoint) -> Result<(), TerminalCleanupError> {
        let mut stopped = self.1.lock().unwrap();
        if checkpoint == self.0 && !*stopped {
            *stopped = true;
            Err(TerminalCleanupError::injected_checkpoint())
        } else {
            Ok(())
        }
    }
}

#[tokio::test]
async fn action_candidate_preserves_tri_state_input_sdl_and_entity_result() {
    let harness = TerminalLifecycleHarness::start().await;
    ticketry_settings::publish_readiness(
        harness.data_directory(),
        &ticketry_settings::Slice2Readiness::complete(),
    )
    .unwrap();

    let actual = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build shipping schema");
    let checked_in = include_str!("../../src/graphql-foundation/generated/schema.graphql");
    assert_eq!(actual.trim(), checked_in.trim(), "full SDL drifted");
    assert!(actual.contains(
        "terminal_session_update(agent_run_id: String!, termination_request_id: String): AgentTerminalSessions!"
    ));

    let selection = "agentRunId terminatedAt";
    let omitted = harness
        .graphql(
            &format!(
                "mutation {{ terminal_session_update(agent_run_id: \"{TASK_RUN_ID}\") {{ {selection} }} }}"
            ),
            serde_json::json!({}),
        )
        .await;
    assert_eq!(
        omitted["data"]["terminal_session_update"]["agentRunId"],
        TASK_RUN_ID
    );
    assert!(omitted["data"]["terminal_session_update"]["terminatedAt"].is_null());

    let explicit_null = harness
        .graphql(
            &format!(
                "mutation {{ terminal_session_update(agent_run_id: \"{TASK_RUN_ID}\", termination_request_id: null) {{ {selection} }} }}"
            ),
            serde_json::json!({}),
        )
        .await;
    assert_eq!(
        explicit_null["errors"][0]["extensions"]["code"],
        "terminal_cleanup_invalid"
    );

    let requested = harness
        .graphql(
            &format!(
                "mutation {{ terminal_session_update(agent_run_id: \"{TASK_RUN_ID}\", termination_request_id: \"action-contract\") {{ {selection} }} }}"
            ),
            serde_json::json!({}),
        )
        .await;
    assert_eq!(
        requested["data"]["terminal_session_update"]["agentRunId"],
        TASK_RUN_ID
    );
    assert!(requested["data"]["terminal_session_update"]["terminatedAt"].is_string());
    let database = harness.database().await;
    assert!(!session(&database).await.runtime_cleanup_pending);
}

#[tokio::test]
async fn action_candidate_settlement_rolls_back_and_recovers_as_one_commit() {
    for checkpoint in [
        CleanupCheckpoint::TerminalTombstone,
        CleanupCheckpoint::RunFact,
        CleanupCheckpoint::StatusAppend,
        CleanupCheckpoint::Settlement,
    ] {
        let harness = TerminalLifecycleHarness::start().await;
        let database = harness.database().await;
        let runtime = Arc::new(ScriptedRuntime::new([
            CleanupRuntimeObservation::Running,
            CleanupRuntimeObservation::Missing,
            CleanupRuntimeObservation::Missing,
        ]));
        let request_id = format!("action-settlement-{checkpoint:?}");
        let stopped = TerminalCleanupService::new(database.clone(), runtime.clone())
            .with_checkpoints(Arc::new(StopOnce(checkpoint, Mutex::new(false))))
            .cleanup(TASK_RUN_ID, CleanupCause::Explicit, &request_id)
            .await;
        assert!(stopped.is_err(), "{checkpoint:?} must stop the response");
        assert_eq!(runtime.kill_count(), 1, "{checkpoint:?}: verified kill");

        let terminal = session(&database).await;
        assert!(
            terminal.terminated_at.is_none(),
            "{checkpoint:?}: tombstone"
        );
        assert!(
            terminal.runtime_cleanup_pending,
            "{checkpoint:?}: journal marker"
        );
        let stopped_run = run(&database).await;
        assert_eq!(stopped_run.status, "running", "{checkpoint:?}: Run outcome");
        assert!(
            stopped_run.ended_at.is_none(),
            "{checkpoint:?}: Run ended_at"
        );
        let leased_effect = effect(&database).await;
        assert_eq!(leased_effect.state, "leased", "{checkpoint:?}: effect");
        assert_eq!(status_count(&database).await, 0, "{checkpoint:?}: status");

        cleanup_effect::Entity::update_many()
            .col_expr(
                cleanup_effect::Column::LeaseExpiresAt,
                Expr::value(Some("2000-01-01T00:00:00.000000Z".to_owned())),
            )
            .filter(cleanup_effect::Column::EffectId.eq(&leased_effect.effect_id))
            .exec(&database)
            .await
            .unwrap();

        let recovered = TerminalCleanupService::new(database.clone(), runtime.clone())
            .cleanup(TASK_RUN_ID, CleanupCause::Explicit, &request_id)
            .await
            .unwrap();
        assert!(recovered.terminated_at.is_some(), "{checkpoint:?}: replay");
        assert!(
            !recovered.runtime_cleanup_pending,
            "{checkpoint:?}: pending"
        );
        assert_eq!(runtime.kill_count(), 1, "{checkpoint:?}: duplicate kill");
        assert_eq!(run(&database).await.status, "terminated");
        assert_eq!(effect(&database).await.state, "applied");
        assert_eq!(status_count(&database).await, 1);
    }
}

async fn session(database: &DatabaseConnection) -> session::Model {
    session::Entity::find_by_id(TASK_RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap()
}

async fn run(database: &DatabaseConnection) -> agent_run::Model {
    agent_run::Entity::find_by_id(TASK_RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap()
}

async fn effect(database: &DatabaseConnection) -> cleanup_effect::Model {
    cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
        .one(database)
        .await
        .unwrap()
        .unwrap()
}

async fn status_count(database: &DatabaseConnection) -> u64 {
    status_event::Entity::find()
        .filter(status_event::Column::AgentRunId.eq(TASK_RUN_ID))
        .filter(status_event::Column::EventKind.eq("agent_run.terminal"))
        .count(database)
        .await
        .unwrap()
}
