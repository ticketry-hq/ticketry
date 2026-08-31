//! Compaction is driven in production, not only by its own unit tests.
//!
//! The failure this file exists to prevent is not a wrong retention decision —
//! `status_compaction_and_reset.rs` covers those — it is a shipping build in
//! which the compaction machinery is complete, correct, and never called. Two
//! things are asserted here: the schedule a desktop launch installs advances a
//! watermark under the *shipped* policy, and the desktop handoff still calls
//! that schedule after reconciliation.

use std::path::Path;
use std::time::Duration;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, Statement};
use ticketry_runs::persistence::{
    CompactionPolicy, CompactionSchedule, RunsServices, COMPACTION_INTERVAL, RETAINED_EVENTS,
    RETENTION_DAYS,
};

mod common;
use common::runs_status_fixture::{FOREIGN_PROJECT, PROJECT};

/// Append `count` rows for one project, aged `age_days` in the past, in one
/// statement. The shipped policy protects the newest hundred thousand events,
/// so a test that exercises it has to reach past that count cheaply.
async fn insert_aged_events(
    database: &DatabaseConnection,
    project_id: &str,
    count: u64,
    age_days: i64,
) {
    let committed_at = (chrono::Utc::now() - chrono::Duration::days(age_days))
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"WITH RECURSIVE row_number(n) AS (
                   SELECT 1 UNION ALL SELECT n + 1 FROM row_number WHERE n < ?
               )
               INSERT INTO runs_status_events
                   (event_id, project_id, event_kind, payload_version, subject_kind, subject_id,
                    payload, committed_at)
               SELECT hex(randomblob(16)), ?, 'agent_run.lifecycle', 1, 'agent_run', 'subject',
                      '{}', ?
               FROM row_number"#,
            [
                (count as i64).into(),
                project_id.into(),
                committed_at.as_str().into(),
            ],
        ))
        .await
        .unwrap();
}

async fn watermark(database: &DatabaseConnection, project_id: &str) -> i64 {
    RunsServices::new(database.clone())
        .outbox()
        .watermarks()
        .get(project_id)
        .await
        .unwrap()
}

async fn event_count(database: &DatabaseConnection, project_id: &str) -> i64 {
    #[derive(Debug, FromQueryResult)]
    struct Row {
        total: i64,
    }
    Row::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "SELECT COUNT(*) AS total FROM runs_status_events WHERE project_id = ?",
        [project_id.into()],
    ))
    .one(database)
    .await
    .unwrap()
    .unwrap()
    .total
}

/// The pass a desktop launch runs, with the policy a desktop launch ships. A
/// build whose compaction is unwired can still pass every policy test; it
/// cannot pass this one, because the watermark it reads afterwards is the one
/// `status_stream` uses to decide that a resuming cursor was compacted away.
#[tokio::test]
async fn the_shipped_startup_pass_advances_the_watermark() {
    let (_directory, database) = common::runs_status_fixture::open().await;
    let excess = 128;
    insert_aged_events(
        &database,
        PROJECT,
        RETAINED_EVENTS + excess,
        RETENTION_DAYS + 1,
    )
    .await;
    assert_eq!(watermark(&database, PROJECT).await, 0);

    let outcomes = CompactionSchedule::new(database.clone())
        .pass()
        .await
        .unwrap();

    // Only the rows past both protections are retired: the newest hundred
    // thousand stay, whatever their age.
    let advanced = watermark(&database, PROJECT).await;
    assert_eq!(advanced, excess as i64);
    assert_eq!(
        event_count(&database, PROJECT).await,
        RETAINED_EVENTS as i64
    );
    let compacted = outcomes
        .iter()
        .find(|outcome| outcome.project_id == PROJECT)
        .expect("the pass visits every project holding history");
    assert_eq!(compacted.compacted_through, advanced);
    assert_eq!(compacted.deleted, excess);
}

/// A project whose history both protections still cover is left alone by the
/// same pass, so wiring compaction into startup cannot cost a quiet
/// installation its short history.
#[tokio::test]
async fn the_shipped_startup_pass_leaves_protected_history_alone() {
    let (_directory, database) = common::runs_status_fixture::open().await;
    insert_aged_events(&database, FOREIGN_PROJECT, 64, RETENTION_DAYS + 1).await;

    CompactionSchedule::new(database.clone())
        .pass()
        .await
        .unwrap();

    assert_eq!(watermark(&database, FOREIGN_PROJECT).await, 0);
    assert_eq!(event_count(&database, FOREIGN_PROJECT).await, 64);
}

/// Startup alone would leave an installation that stays open for weeks with an
/// unbounded outbox. The periodic driver runs the same pass again, so history
/// committed after launch is retired without one.
#[tokio::test]
async fn the_periodic_driver_runs_the_pass_again() {
    let (_directory, database) = common::runs_status_fixture::open().await;
    let policy = CompactionPolicy {
        retention_days: 1,
        retained_events: 8,
        ..CompactionPolicy::default()
    };
    let schedule = CompactionSchedule::new(database.clone())
        .with_policy(policy)
        .with_interval(Duration::from_millis(25));
    insert_aged_events(&database, PROJECT, 24, 2).await;
    schedule.pass().await.unwrap();
    let after_startup = watermark(&database, PROJECT).await;
    assert_eq!(after_startup, 16);

    let driver = tokio::spawn(schedule.clone().drive());
    insert_aged_events(&database, PROJECT, 16, 2).await;
    let advanced = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let current = watermark(&database, PROJECT).await;
            if current > after_startup {
                return current;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("the periodic driver compacts the history committed after startup");
    driver.abort();

    assert_eq!(advanced, 32);
    assert_eq!(event_count(&database, PROJECT).await, 8);
}

/// The shipped interval has to be short enough that a long-lived installation
/// is compacted while it runs, and long enough that the pass is never
/// competing with live status writers.
#[test]
fn the_shipped_interval_is_measured_in_hours() {
    assert!(COMPACTION_INTERVAL >= Duration::from_secs(60 * 60));
    assert!(COMPACTION_INTERVAL <= Duration::from_secs(24 * 60 * 60));
}

/// The regression this ticket was filed for: the machinery existed and had no
/// production caller. The handoff is the one production startup path, and it
/// is not reachable from a test without a live sidecar, so the wiring itself
/// is asserted here rather than left to be silently deleted.
#[test]
fn the_desktop_handoff_drives_compaction_after_reconciliation() {
    let source = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/desktop/runs_handoff.rs"),
    )
    .unwrap();
    assert!(
        source.contains("CompactionSchedule"),
        "the Runs handoff must install the compaction schedule"
    );
    for gate in [
        "pub(crate) async fn reopen_gate",
        "pub(crate) async fn open_gate",
    ] {
        let body = source
            .split_once(gate)
            .expect("both gates are still declared")
            .1;
        let reconcile = body
            .find("reconcile(database")
            .expect("the gate reconciles");
        let compact = body.find("compact(database").expect("the gate compacts");
        assert!(
            reconcile < compact,
            "{gate} must compact after it reconciles"
        );
    }
}
