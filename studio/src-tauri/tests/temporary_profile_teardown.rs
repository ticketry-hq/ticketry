//! A temporary profile records what it destroys.
//!
//! Its whole-profile terminal cleanup is deliberate, but it is journalled
//! through the same cause-bound cleanup effects every other teardown uses, so
//! an unconfirmed kill leaves durable, retryable evidence instead of dying
//! with the database.

mod common;

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, DOCUMENT_RUN_ID, TASK_RUN_ID};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use ticketry_entities::terminals::{cleanup_effect, session};
use ticketry_terminal::temporary_profile::{
    journal_profile_teardown, journal_terminal_cleanup, ProfileTeardownOutcome,
};
use ticketry_terminal::terminal::cleanup::{
    CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime, TerminalCleanupService,
};

/// Answers every inspection the same way, so a whole-profile teardown meets a
/// single, deliberate runtime condition.
struct FixedRuntime {
    observations: Mutex<Vec<CleanupRuntimeObservation>>,
    kills: Mutex<usize>,
}

impl FixedRuntime {
    fn always(observation: CleanupRuntimeObservation) -> Arc<Self> {
        Arc::new(Self {
            observations: Mutex::new(vec![observation]),
            kills: Mutex::new(0),
        })
    }

    fn answer_with(&self, observation: CleanupRuntimeObservation) {
        *self.observations.lock().unwrap() = vec![observation];
    }
}

#[async_trait]
impl TerminalCleanupRuntime for FixedRuntime {
    async fn inspect(&self, _: &session::Model) -> CleanupRuntimeObservation {
        self.observations.lock().unwrap()[0]
    }

    async fn kill_verified(&self, _: &session::Model) -> CleanupKillResult {
        *self.kills.lock().unwrap() += 1;
        CleanupKillResult::Killed
    }
}

async fn effects(
    database: &sea_orm::DatabaseConnection,
) -> Vec<ticketry_entities::terminals::cleanup_effect::Model> {
    cleanup_effect::Entity::find()
        .order_by_asc(cleanup_effect::Column::AgentRunId)
        .all(database)
        .await
        .expect("read the cleanup journal")
}

async fn terminal(database: &sea_orm::DatabaseConnection, agent_run_id: &str) -> session::Model {
    session::Entity::find_by_id(agent_run_id)
        .one(database)
        .await
        .expect("read the terminal session")
        .expect("terminal session exists")
}

#[tokio::test]
async fn every_recorded_terminal_is_journalled_before_the_profile_is_disposable() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = FixedRuntime::always(CleanupRuntimeObservation::Missing);
    let service = TerminalCleanupService::new(database.clone(), runtime);

    let teardown = journal_terminal_cleanup(&service)
        .await
        .expect("journal the temporary profile teardown");

    assert_eq!(teardown.journaled, 2, "both live terminals are journalled");
    assert!(teardown.is_complete(), "{teardown:?}");
    let journal = effects(&database).await;
    assert_eq!(journal.len(), 2);
    for effect in &journal {
        assert_eq!(effect.cause, "temporary_profile");
        assert_eq!(effect.state, "applied");
    }
    for run_id in [DOCUMENT_RUN_ID, TASK_RUN_ID] {
        let terminal = terminal(&database, run_id).await;
        assert!(terminal.terminated_at.is_some(), "{run_id} is tombstoned");
        assert!(!terminal.runtime_cleanup_pending);
    }
}

#[tokio::test]
async fn unconfirmed_cleanup_keeps_the_journal_unresolved_instead_of_reporting_success() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = FixedRuntime::always(CleanupRuntimeObservation::Unavailable);
    let service = TerminalCleanupService::new(database.clone(), runtime);

    let teardown = journal_terminal_cleanup(&service)
        .await
        .expect("journal the temporary profile teardown");

    assert_eq!(teardown.journaled, 2);
    assert!(
        !teardown.is_complete(),
        "an unverified runtime must not clear the profile"
    );
    let unresolved: Vec<_> = teardown
        .unresolved
        .iter()
        .map(|entry| (entry.agent_run_id.as_str(), entry.state.as_str()))
        .collect();
    assert_eq!(unresolved.len(), 2, "{:?}", teardown.unresolved);
    for (_, state) in &unresolved {
        assert_eq!(*state, "cleanup_pending");
    }
    assert!(teardown
        .unresolved
        .iter()
        .all(|entry| entry.last_error_code.as_deref() == Some("terminal_runtime_unavailable")));
    let terminal = terminal(&database, TASK_RUN_ID).await;
    assert!(terminal.terminated_at.is_none(), "no false tombstone");
    assert!(terminal.runtime_cleanup_pending);
}

#[tokio::test]
async fn a_retried_teardown_reuses_its_predetermined_effect_and_keeps_the_history() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = FixedRuntime::always(CleanupRuntimeObservation::Unavailable);
    let service = TerminalCleanupService::new(database.clone(), runtime.clone());

    let deferred = journal_terminal_cleanup(&service)
        .await
        .expect("journal the deferred teardown");
    assert!(!deferred.is_complete());
    let first_pass: Vec<_> = effects(&database)
        .await
        .into_iter()
        .map(|effect| effect.effect_id)
        .collect();

    runtime.answer_with(CleanupRuntimeObservation::Missing);
    let retried = journal_terminal_cleanup(&service)
        .await
        .expect("journal the retried teardown");

    assert!(retried.is_complete(), "{retried:?}");
    let second_pass = effects(&database).await;
    assert_eq!(
        second_pass
            .iter()
            .map(|effect| effect.effect_id.clone())
            .collect::<Vec<_>>(),
        first_pass,
        "retry reuses the predetermined cleanup effect identity"
    );
    for effect in &second_pass {
        assert_eq!(effect.state, "applied");
        assert!(effect.attempt_count >= 2, "the retry is counted");
    }
}

#[tokio::test]
async fn a_profile_without_terminal_storage_has_no_history_to_lose() {
    let directory = tempfile::tempdir().expect("create an empty profile");
    let path = directory.path().to_owned();

    let outcome = std::thread::spawn(move || journal_profile_teardown(&path))
        .join()
        .expect("run the blocking teardown seam");

    assert_eq!(outcome, ProfileTeardownOutcome::NoTerminalHistory);
    assert!(outcome.is_complete());
}

#[tokio::test]
async fn the_blocking_teardown_seam_journals_the_profile_it_is_given() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let profile = harness.data_directory().to_owned();

    let outcome = std::thread::spawn(move || journal_profile_teardown(&profile))
        .join()
        .expect("run the blocking teardown seam");

    let ProfileTeardownOutcome::Journaled(teardown) = &outcome else {
        panic!("the profile database must be journalled: {outcome:?}");
    };
    assert_eq!(teardown.journaled, 2);
    let journal = effects(&database).await;
    assert_eq!(journal.len(), 2);
    assert!(journal
        .iter()
        .all(|effect| effect.cause == "temporary_profile"));
    let recorded_causes = cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::Cause.ne("temporary_profile"))
        .all(&database)
        .await
        .expect("read the cleanup journal");
    assert!(
        recorded_causes.is_empty(),
        "teardown must not rebind another cause"
    );
}
