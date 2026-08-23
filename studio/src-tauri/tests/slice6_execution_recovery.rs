//! Slice 6, across process boundaries: crash, restart, adoption, and shutdown.
//!
//! Each case stops the composed runtime at a durable boundary or between opens,
//! composes it again over the same database and the same private tmux server,
//! and observes what converged. Recovery is never invoked directly: it is what
//! startup does, so every assertion here is about a real reopen.

mod common;

use common::execution_django_fixture as fixture;
use common::execution_harness::{public_id, ExecutionHarness, HarnessOptions};
use muxed_studio_lib::terminal_launch::TerminalLaunchBoundary;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};

#[tokio::test]
async fn a_crash_before_the_response_leaves_one_claim_and_one_runtime_after_restart() {
    let mut harness = ExecutionHarness::start_with_options(HarnessOptions {
        stop_once_at: Some(TerminalLaunchBoundary::ResponseReady),
        ..HarnessOptions::default()
    })
    .await;
    // The claim and its launch committed; only the acknowledgement was lost.
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let claims_before = claim_tuples(&database).await;
    assert!(!claims_before.is_empty(), "the interrupted claim committed");

    harness.restart().await;

    // Startup replayed the same generation rather than starting a second agent.
    assert_eq!(claim_tuples(&database).await, claims_before);
    assert_eq!(
        count(&database, "agent_runs").await,
        claims_before.len() as i64
    );
    assert_eq!(harness.live_runtimes().len(), claims_before.len());
    harness.shutdown().await;
}

#[tokio::test]
async fn a_crash_after_runtime_creation_adopts_the_same_runtime_on_restart() {
    let mut harness = ExecutionHarness::start_with_options(HarnessOptions {
        stop_once_at: Some(TerminalLaunchBoundary::TmuxCreated),
        ..HarnessOptions::default()
    })
    .await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let claims_before = claim_tuples(&database).await;
    let runtimes_before = harness.live_runtimes();

    harness.restart().await;

    // Reopening changes nothing about the interrupted launch on its own: its
    // effect is still leased to the process that committed it, so recovery
    // waits rather than racing a second runtime into the same identity.
    assert_eq!(claim_tuples(&database).await, claims_before);
    assert_eq!(harness.live_runtimes(), runtimes_before);
    assert_eq!(
        count(&database, "agent_runs").await,
        claims_before.len() as i64
    );

    // Once that lease has aged out, recovery adopts the runtime the crash left
    // behind under its predetermined identity, and records it once.
    harness.expire_launch_leases().await;
    harness.sweep_terminals().await;
    assert_eq!(claim_tuples(&database).await, claims_before);
    assert_eq!(harness.live_runtimes(), runtimes_before);
    assert_eq!(
        count(&database, "agent_runs").await,
        claims_before.len() as i64
    );
    assert_eq!(
        count(&database, "agent_terminal_sessions").await,
        claims_before.len() as i64,
        "every claimed child ends with exactly one recorded Terminal session"
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn an_armed_parallel_campaign_resumes_released_children_at_startup() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    assert_eq!(claimed_children(&database).await, ready_children());

    // The outside blocker is satisfied while nothing is watching, so only a
    // reopen can notice that the held child is now eligible.
    harness.set_state(fixture::OUTSIDE_BLOCKER, "Done").await;
    harness.shutdown().await;
    harness.restart().await;

    assert_eq!(
        claimed_children(&database).await,
        vec![
            public_id(fixture::READY_FIRST),
            public_id(fixture::READY_SECOND),
            public_id(fixture::EXTERNALLY_BLOCKED),
        ]
    );
    assert_eq!(harness.live_runtimes().len(), 3);
    harness.shutdown().await;
}

#[tokio::test]
async fn an_armed_serial_campaign_resumes_only_when_its_frontier_is_clear() {
    let mut harness = ExecutionHarness::start().await;
    harness
        .graphql(CREATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::SERIAL_FIRST).await;

    // A live frontier is adopted rather than competed with.
    harness.restart().await;
    assert_eq!(
        claimed_children(&database).await,
        vec![public_id(fixture::SERIAL_FIRST)]
    );
    assert_eq!(harness.live_runtimes().len(), 1);

    // A satisfied and inactive frontier releases the next child on reopen.
    harness.set_state(fixture::SERIAL_FIRST, "Review").await;
    harness.end_runtime(&first_run).await;
    harness.restart().await;
    assert_eq!(
        claimed_children(&database).await,
        vec![
            public_id(fixture::SERIAL_FIRST),
            public_id(fixture::SERIAL_SECOND),
        ]
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn an_ended_unsatisfied_serial_frontier_stays_stalled_across_a_restart() {
    let mut harness = ExecutionHarness::start().await;
    harness
        .graphql(CREATE, serial(fixture::SERIAL_CAMPAIGN_ROOT))
        .await;
    let database = harness.database().await;
    let first_run = claim_run(&database, fixture::SERIAL_FIRST).await;
    harness.end_runtime(&first_run).await;
    let stalled = claim_tuples(&database).await;

    harness.restart().await;

    // Recovery neither skips the stalled child nor silently retries it.
    assert_eq!(claim_tuples(&database).await, stalled);
    assert_eq!(
        claimed_children(&database).await,
        vec![public_id(fixture::SERIAL_FIRST)]
    );
    assert!(harness.live_runtimes().is_empty());
    harness.shutdown().await;
}

#[tokio::test]
async fn an_auto_start_transition_produces_one_launch_across_a_crash_and_restart() {
    let mut harness = ExecutionHarness::start().await;
    // Entering Implement is the auto-start transition for this type.
    let moved = harness.set_state(fixture::READY_FIRST, "Implement").await;
    assert_eq!(moved["ok"], json!(true), "{moved}");
    let database = harness.database().await;
    assert_eq!(
        count(&database, "worktracker_transitionoccurrence").await,
        1
    );

    // A transition that is not auto-start stays durably inert.
    harness.set_state(fixture::READY_SECOND, "Review").await;

    // The committed occurrence is what automation reads, and it reads it once
    // however many times the process reopens.
    harness.restart().await;
    let attempts = count(&database, "automation_attempts").await;
    assert_eq!(attempts, 1, "one occurrence materializes one attempt");
    let runs = count(&database, "agent_runs").await;
    assert!(runs <= 1, "auto-start prepares at most one launch: {runs}");

    harness.restart().await;
    assert_eq!(count(&database, "automation_attempts").await, attempts);
    assert_eq!(count(&database, "agent_runs").await, runs);
    harness.shutdown().await;
}

#[tokio::test]
async fn simultaneous_presses_and_events_converge_on_one_claim_per_child() {
    let mut harness = ExecutionHarness::start().await;
    let reconciliation = harness.reconciliation();

    // A manual press races a lifecycle wake-up over the same root.
    let (pressed, woken, pressed_again) = tokio::join!(
        harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT),
        reconciliation
            .reconcile_work_item(fixture::PARALLEL_CAMPAIGN_ROOT, fixture::CAMPAIGN_PROJECT),
        harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT),
    );

    let database = harness.database().await;
    assert_eq!(claimed_children(&database).await, ready_children());
    // One claim, one Agent Run, and one verified runtime per child, whichever
    // caller won the race.
    assert_eq!(count(&database, "agent_runs").await, 2);
    assert_eq!(harness.live_runtimes().len(), 2);
    assert_eq!(count(&database, "launched_tasks").await, 2);
    for observed in [&pressed, &pressed_again] {
        assert!(
            observed["root_id"] == public_id(fixture::PARALLEL_CAMPAIGN_ROOT),
            "{observed}"
        );
    }
    assert!(woken.diagnostics.is_empty(), "{woken:?}");
    harness.shutdown().await;
}

#[tokio::test]
async fn a_periodic_pass_is_the_backstop_for_a_dropped_wakeup() {
    let mut harness = ExecutionHarness::start_with_options(HarnessOptions {
        pass_interval: std::time::Duration::from_millis(50),
        ..HarnessOptions::default()
    })
    .await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;

    // Nothing tells execution that the blocker moved; only the bounded
    // periodic pass can notice.
    harness.set_state(fixture::OUTSIDE_BLOCKER, "Done").await;
    let released = public_id(fixture::EXTERNALLY_BLOCKED);
    for _ in 0..100 {
        if claimed_children(&database).await.contains(&released) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(
        claimed_children(&database).await.contains(&released),
        "the periodic pass never released the held child"
    );
    harness.shutdown().await;
}

#[tokio::test]
async fn normal_shutdown_leaves_campaigns_and_runtimes_durable() {
    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    let database = harness.database().await;
    let claims = claim_tuples(&database).await;
    let runtimes = harness.live_runtimes();

    harness.shutdown().await;

    // Shutdown resets nothing, ends no Agent Run, and terminates no runtime.
    assert_eq!(claim_tuples(&database).await, claims);
    assert_eq!(
        count_where(&database, "agent_runs", "ended_at IS NOT NULL").await,
        0
    );
    assert_eq!(harness.live_runtimes(), runtimes);

    // Reopening reconciles once and continues the same campaign.
    harness.restart().await;
    assert_eq!(claim_tuples(&database).await, claims);
    assert_eq!(harness.live_runtimes(), runtimes);
    harness.shutdown().await;
}

#[tokio::test]
async fn adopting_copied_campaign_data_preserves_it_across_two_opens() {
    // A store that already carries a serial campaign, a settled claim, a
    // parallel campaign without a policy snapshot, and a compatibility receipt.
    let mut harness =
        ExecutionHarness::start_over(HarnessOptions::default(), fixture::provision_current).await;
    let database = harness.database().await;
    let first = (
        claim_tuples(&database).await,
        count(&database, "graph_runs").await,
        count(&database, "launch_policy_effects").await,
    );
    assert_eq!(first.1, 2);
    assert_eq!(first.2, 1);
    assert_eq!(
        claimed_children(&database).await,
        vec![public_id(fixture::CLAIMED_CHILD)]
    );

    harness.restart().await;

    assert_eq!(
        (
            claim_tuples(&database).await,
            count(&database, "graph_runs").await,
            count(&database, "launch_policy_effects").await,
        ),
        first
    );
    // Adoption starts nothing: the campaign it inherited had already settled.
    assert!(harness.live_runtimes().is_empty());
    harness.shutdown().await;
}

#[tokio::test]
async fn adoption_refuses_an_uncertain_execution_schema_before_any_write_or_launch() {
    for (label, mutation) in [
        ("unknown column", "ALTER TABLE graph_runs ADD COLUMN surprise text"),
        ("invalid mode", "UPDATE graph_runs SET execution_mode='recursive'"),
        (
            "malformed policy",
            "PRAGMA ignore_check_constraints=ON; UPDATE graph_runs SET launch_configuration='not-json'",
        ),
        (
            "duplicate child assignment",
            "UPDATE launched_tasks SET task_id=(SELECT root_id FROM graph_runs LIMIT 1)",
        ),
        ("missing Agent Run", "UPDATE launched_tasks SET agent_run_id='missing-run'"),
        (
            "inconsistent active runtime",
            "UPDATE agent_runs SET ended_at=NULL WHERE id='run-893'",
        ),
    ] {
        let refusal = ExecutionHarness::try_adopt(|directory| {
            fixture::provision_current(directory);
            fixture::mutate(directory, mutation);
        })
        .await
        .expect_err(label);
        assert!(
            !refusal.contains("Implement the slice."),
            "{label} leaked launch material: {refusal}"
        );
    }
}

const CREATE: &str = r#"
mutation Create($rootId: String!, $executionMode: String) {
  graph_run_result: graph_run_create(root_id: $rootId, execution_mode: $executionMode) {
    graph_run { root_id: rootId execution_mode: executionMode }
    prepared: prepared_child_ids
  }
}
"#;

fn serial(root_id: &str) -> Value {
    json!({"rootId": root_id, "executionMode": "serial"})
}

fn ready_children() -> Vec<String> {
    vec![
        public_id(fixture::READY_FIRST),
        public_id(fixture::READY_SECOND),
    ]
}

async fn claimed_children(database: &DatabaseConnection) -> Vec<String> {
    let mut children = rows(database, "SELECT task_id FROM launched_tasks")
        .await
        .into_iter()
        .map(|id| public_id(&id))
        .collect::<Vec<_>>();
    children.sort();
    children
}

/// Every campaign claim as a caller-visible tuple, so a restart can be checked
/// for having changed nothing rather than for having run some function.
async fn claim_tuples(database: &DatabaseConnection) -> Vec<String> {
    let mut tuples = rows(
        database,
        "SELECT task_id || '|' || root_id || '|' || claim_id || '|' || agent_run_id \
         || '|' || launch_effect_id || '|' || launch_generation FROM launched_tasks",
    )
    .await;
    tuples.sort();
    tuples
}

async fn claim_run(database: &DatabaseConnection, task_id: &str) -> String {
    rows(
        database,
        &format!("SELECT agent_run_id FROM launched_tasks WHERE task_id='{task_id}'"),
    )
    .await
    .pop()
    .unwrap_or_else(|| panic!("{task_id} has a campaign claim"))
}

async fn rows(database: &DatabaseConnection, query: &str) -> Vec<String> {
    database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .expect("read durable execution facts")
        .into_iter()
        .filter_map(|row| row.try_get_by_index::<Option<String>>(0).ok().flatten())
        .collect()
}

async fn count(database: &DatabaseConnection, table: &str) -> i64 {
    scalar(database, &format!("SELECT COUNT(*) FROM {table}")).await
}

async fn count_where(database: &DatabaseConnection, table: &str, predicate: &str) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) FROM {table} WHERE {predicate}"),
    )
    .await
}

async fn scalar(database: &DatabaseConnection, query: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .expect("read a durable count")
        .expect("SQLite returns one row")
        .try_get_by_index(0)
        .expect("counts are integers")
}
