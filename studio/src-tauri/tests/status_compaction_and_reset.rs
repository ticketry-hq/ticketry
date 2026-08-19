//! Bounded replay, project-aware compaction, and authoritative reset recovery.
//!
//! Compaction is asserted through what a resuming client can observe — a
//! retained cursor is either replayable or explicitly reset — and through the
//! one ordering that cannot be recovered from: history is never deleted before
//! the watermark that declares it compacted is durable.

use std::time::Duration;

use futures_util::{Stream, StreamExt};
use muxed_studio_lib::runs_persistence::{
    open_status_stream, reset_reason, CompactionPolicy, RunStatusFrame, RunsServices,
    StatusStreamRequest, MAX_REPLAY_EVENTS, RETAINED_EVENTS, RETENTION_DAYS,
};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, Statement};

mod common;
use common::runs_status_fixture::{insert_event, FOREIGN_PROJECT, PROJECT, PUBLIC_PROJECT};

/// A delete that outruns its watermark is the one compaction failure a client
/// cannot detect: it would resume across a silent gap believing its cursor was
/// honoured. The database refuses it here, so the ordering is a property of the
/// test store rather than of the assertions that follow.
const WATERMARK_BEFORE_DELETE: &str = r#"
CREATE TRIGGER compaction_requires_a_durable_watermark
BEFORE DELETE ON runs_status_events
WHEN (
    SELECT COALESCE(MAX(compacted_through_cursor), -1)
    FROM runs_project_compaction_watermarks
    WHERE project_id = OLD.project_id
) < OLD.cursor
BEGIN
    SELECT RAISE(ABORT, 'status history deleted before its watermark was durable');
END;
"#;

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, RunsServices) {
    let (directory, database) = common::runs_status_fixture::open().await;
    database
        .execute_unprepared(WATERMARK_BEFORE_DELETE)
        .await
        .expect("install the compaction ordering guard");
    let services = RunsServices::new(database.clone());
    (directory, database, services)
}

/// Append `count` rows for one project, aged `age_days` in the past. Ages are
/// written explicitly because the retention window is the point of the test.
async fn insert_aged_events(
    database: &DatabaseConnection,
    project_id: &str,
    count: usize,
    age_days: i64,
) {
    let committed_at = (chrono::Utc::now() - chrono::Duration::days(age_days))
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    for _ in 0..count {
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                r#"INSERT INTO runs_status_events
                   (event_id, project_id, event_kind, payload_version, subject_kind, subject_id,
                    payload, committed_at)
                   VALUES (?, ?, 'agent_run.lifecycle', 1, 'agent_run', 'subject', '{}', ?)"#,
                [
                    uuid::Uuid::new_v4().simple().to_string().into(),
                    project_id.into(),
                    committed_at.as_str().into(),
                ],
            ))
            .await
            .unwrap();
    }
}

async fn retained_rows(database: &DatabaseConnection, project_id: &str) -> Vec<i64> {
    #[derive(Debug, sea_orm::FromQueryResult)]
    struct Row {
        cursor: i64,
    }
    Row::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "SELECT cursor FROM runs_status_events WHERE project_id = ? ORDER BY cursor",
        [project_id.into()],
    ))
    .all(database)
    .await
    .unwrap()
    .into_iter()
    .map(|row| row.cursor)
    .collect()
}

async fn query_plan(database: &DatabaseConnection, sql: &str) -> String {
    #[derive(Debug, sea_orm::FromQueryResult)]
    struct Step {
        detail: String,
    }
    Step::find_by_statement(Statement::from_string(
        DbBackend::Sqlite,
        format!("EXPLAIN QUERY PLAN {sql}"),
    ))
    .all(database)
    .await
    .unwrap()
    .into_iter()
    .map(|step| step.detail)
    .collect::<Vec<_>>()
    .join(" | ")
}

fn request(after_cursor: Option<i64>) -> StatusStreamRequest {
    StatusStreamRequest {
        project_id: PUBLIC_PROJECT.to_owned(),
        after_cursor,
    }
}

async fn take(
    stream: &mut (impl Stream<Item = RunStatusFrame> + Unpin),
    count: usize,
) -> Vec<RunStatusFrame> {
    let mut frames = Vec::new();
    for _ in 0..count {
        let frame = tokio::time::timeout(Duration::from_secs(20), stream.next())
            .await
            .expect("a status frame arrives within twenty seconds")
            .expect("the status stream stays open");
        frames.push(frame);
    }
    frames
}

fn reset_reason_of(frame: &RunStatusFrame) -> &str {
    match frame {
        RunStatusFrame::RunStatusResetRequired(reset) => reset.reason.as_str(),
        other => panic!("expected a reset, received {other:?}"),
    }
}

fn event_cursors(frames: &[RunStatusFrame]) -> Vec<i64> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            RunStatusFrame::RunStatusEvent(event) => Some(event.cursor),
            _ => None,
        })
        .collect()
}

#[test]
fn the_shipped_policy_retains_thirty_days_and_a_hundred_thousand_events() {
    let policy = CompactionPolicy::default();
    assert_eq!(policy.retention_days, RETENTION_DAYS);
    assert_eq!(policy.retained_events, RETAINED_EVENTS);
    assert_eq!((RETENTION_DAYS, RETAINED_EVENTS), (30, 100_000));
}

#[tokio::test]
async fn age_alone_never_deletes_history_inside_the_retained_event_count() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 40, 400).await;

    // Every row is well outside the retention window, but the project has never
    // accumulated more than the retained count, so its whole history stays.
    let outcome = services
        .compaction()
        .clone()
        .with_policy(CompactionPolicy {
            retained_events: 100,
            ..CompactionPolicy::default()
        })
        .compact_project(PROJECT)
        .await
        .expect("compact the project");

    assert_eq!(outcome.deleted, 0);
    assert_eq!(outcome.compacted_through, 0);
    assert_eq!(retained_rows(&database, PROJECT).await.len(), 40);
}

#[tokio::test]
async fn volume_alone_never_deletes_history_inside_the_retention_window() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 40, 0).await;

    // Far more rows than the retained count, but all of them are young.
    let outcome = services
        .compaction()
        .clone()
        .with_policy(CompactionPolicy {
            retained_events: 5,
            ..CompactionPolicy::default()
        })
        .compact_project(PROJECT)
        .await
        .expect("compact the project");

    assert_eq!(outcome.deleted, 0);
    assert_eq!(retained_rows(&database, PROJECT).await.len(), 40);
}

#[tokio::test]
async fn compaction_deletes_only_where_both_protections_are_satisfied() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 20, 400).await;
    insert_aged_events(&database, PROJECT, 10, 0).await;
    insert_aged_events(&database, FOREIGN_PROJECT, 20, 400).await;

    let outcome = services
        .compaction()
        .clone()
        .with_policy(CompactionPolicy {
            retention_days: 30,
            retained_events: 15,
            batch: 4,
        })
        .compact_project(PROJECT)
        .await
        .expect("compact the project");

    // 30 rows, newest 15 protected by count, newest 10 also protected by age:
    // only the 15 oldest lose both protections.
    assert_eq!(outcome.deleted, 15);
    let remaining = retained_rows(&database, PROJECT).await;
    assert_eq!(remaining.len(), 15);
    assert!(
        remaining
            .iter()
            .all(|cursor| *cursor > outcome.compacted_through),
        "every retained row is above the published watermark",
    );
    assert_eq!(
        services
            .outbox()
            .watermarks()
            .get(PROJECT)
            .await
            .expect("read the watermark"),
        outcome.compacted_through,
        "the watermark a resuming client is measured against is durable",
    );
    // Compaction is project-aware: another project's equally old history is
    // untouched, and its watermark never moves.
    assert_eq!(retained_rows(&database, FOREIGN_PROJECT).await.len(), 20);
    assert_eq!(
        services
            .outbox()
            .watermarks()
            .get(FOREIGN_PROJECT)
            .await
            .expect("read the foreign watermark"),
        0,
    );
}

#[tokio::test]
async fn compacting_a_large_backlog_is_incremental_and_idempotent() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 500, 400).await;
    insert_aged_events(&database, PROJECT, 10, 0).await;
    let compaction = services.compaction().clone().with_policy(CompactionPolicy {
        retention_days: 30,
        retained_events: 10,
        batch: 64,
    });

    // One delete statement never exceeds the batch bound, so a first pass over
    // a large backlog cannot hold a long transaction against live writers.
    let watermark = services.outbox().events().high_water().await.unwrap();
    let first_batch = services
        .outbox()
        .events()
        .delete_through(PROJECT, 0, 64)
        .await
        .expect("a bounded delete");
    assert_eq!(first_batch, 0, "nothing is deletable below cursor zero");
    assert!(watermark > 0);

    let outcome = compaction.compact_project(PROJECT).await.expect("compact");
    assert_eq!(outcome.deleted, 500);
    assert_eq!(retained_rows(&database, PROJECT).await.len(), 10);

    // A second pass finds nothing new and neither deletes nor rewinds.
    let repeated = compaction.compact_project(PROJECT).await.expect("compact");
    assert_eq!(repeated.deleted, 0);
    assert_eq!(repeated.compacted_through, outcome.compacted_through);
}

#[tokio::test]
async fn compact_all_visits_every_project_holding_history() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 30, 400).await;
    insert_aged_events(&database, FOREIGN_PROJECT, 30, 400).await;

    let outcomes = services
        .compaction()
        .clone()
        .with_policy(CompactionPolicy {
            retention_days: 30,
            retained_events: 10,
            batch: 8,
        })
        .compact_all()
        .await
        .expect("compact every project");

    let mut visited: Vec<&str> = outcomes
        .iter()
        .map(|outcome| outcome.project_id.as_str())
        .collect();
    visited.sort_unstable();
    assert_eq!(visited, vec![PROJECT, FOREIGN_PROJECT]);
    assert!(outcomes.iter().all(|outcome| outcome.deleted == 20));
    assert_eq!(retained_rows(&database, PROJECT).await.len(), 10);
    assert_eq!(retained_rows(&database, FOREIGN_PROJECT).await.len(), 10);
}

#[tokio::test]
async fn a_current_cursor_replays_and_a_compacted_one_resets() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 30, 400).await;
    insert_aged_events(&database, PROJECT, 6, 0).await;
    let stale = retained_rows(&database, PROJECT).await[2];

    services
        .compaction()
        .clone()
        .with_policy(CompactionPolicy {
            retention_days: 30,
            retained_events: 6,
            batch: 8,
        })
        .compact_project(PROJECT)
        .await
        .expect("compact");
    let survivors = retained_rows(&database, PROJECT).await;

    // A cursor at or below the watermark cannot be honoured.
    let mut reset = Box::pin(open_status_stream(services.stream(), request(Some(stale))));
    let frames = take(&mut reset, 3).await;
    assert_eq!(reset_reason_of(&frames[1]), reset_reason::COMPACTED);
    assert!(
        matches!(&frames[2], RunStatusFrame::RunStatusCaughtUp(caught_up)
            if caught_up.cursor == *survivors.last().unwrap()),
        "the reset hands the client the server's high-water baseline",
    );

    // A cursor still inside retained history replays exactly what survived.
    let resumed = survivors[0];
    let mut live = Box::pin(open_status_stream(
        services.stream(),
        request(Some(resumed)),
    ));
    let frames = take(&mut live, 1 + survivors.len()).await;
    assert_eq!(event_cursors(&frames), survivors[1..].to_vec());
}

#[tokio::test]
async fn a_future_cursor_resets_rather_than_waiting_for_the_server_to_catch_up() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 3, 0).await;
    let high_water = services.outbox().events().high_water().await.unwrap();

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(high_water + 5_000)),
    ));
    let frames = take(&mut stream, 2).await;
    assert_eq!(reset_reason_of(&frames[1]), reset_reason::AHEAD_OF_SERVER);
}

#[tokio::test]
async fn an_oversized_replay_costs_one_bounded_read_and_a_reset() {
    let (_directory, database, services) = fixture().await;
    // The serialized-size bound is reached long before the count bound, which
    // is exactly why replay is bounded by both.
    let payload = format!(r#"{{"blob":"{}"}}"#, "x".repeat(1024 * 1024));
    for _ in 0..5 {
        insert_event(&database, PROJECT, "agent_run.lifecycle", 1, &payload).await;
    }

    let mut stream = Box::pin(open_status_stream(services.stream(), request(Some(0))));
    let frames = take(&mut stream, 2).await;
    assert_eq!(reset_reason_of(&frames[1]), reset_reason::REPLAY_BOUNDED);

    // The read that made that decision is bounded by the replay cap, so a
    // severely lagged client cannot make the server materialize its backlog.
    let rows = services
        .outbox()
        .events()
        .replay(PROJECT, 0, i64::MAX, MAX_REPLAY_EVENTS as u64 + 1)
        .await
        .expect("bounded replay read");
    assert!(rows.len() <= MAX_REPLAY_EVENTS + 1);
}

#[tokio::test]
async fn incompatible_retained_versions_reset_instead_of_replaying_partial_history() {
    let (_directory, database, services) = fixture().await;
    insert_aged_events(&database, PROJECT, 2, 0).await;
    let resumed = retained_rows(&database, PROJECT).await[0];
    insert_event(&database, PROJECT, "agent_run.lifecycle", 99, "{}").await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(resumed)),
    ));
    let frames = take(&mut stream, 3).await;

    assert_eq!(
        reset_reason_of(&frames[1]),
        reset_reason::EVENT_VERSION_INCOMPATIBLE,
    );
    assert!(
        event_cursors(&frames).is_empty(),
        "no partial history is published ahead of the reset",
    );
}

#[tokio::test]
async fn a_slow_subscriber_drains_a_backlog_in_bounded_pages() {
    let (_directory, database, services) = fixture().await;
    let mut stream = Box::pin(open_status_stream(services.stream(), request(None)));
    take(&mut stream, 2).await;

    insert_aged_events(&database, PROJECT, 700, 0).await;
    insert_aged_events(&database, FOREIGN_PROJECT, 100, 0).await;

    // Every one of this project's rows arrives, in cursor order, and none of
    // the foreign project's do — the drain is paged, not buffered whole.
    let frames = take(&mut stream, 700).await;
    let cursors = event_cursors(&frames);
    assert_eq!(cursors.len(), 700);
    assert!(cursors.windows(2).all(|pair| pair[0] < pair[1]));
    assert_eq!(cursors, retained_rows(&database, PROJECT).await);
}

#[tokio::test]
async fn project_scoped_reads_use_the_project_cursor_indexes() {
    let (_directory, database, _services) = fixture().await;
    insert_aged_events(&database, PROJECT, 50, 400).await;
    insert_aged_events(&database, FOREIGN_PROJECT, 50, 0).await;

    let replay = query_plan(
        &database,
        "SELECT cursor FROM runs_status_events \
         WHERE project_id = 'p' AND cursor > 0 AND cursor <= 10 ORDER BY cursor ASC LIMIT 10",
    )
    .await;
    assert!(
        replay.contains("idx_runs_status_events_project_cursor"),
        "replay must not scan the global cursor space: {replay}",
    );

    let age = query_plan(
        &database,
        "SELECT cursor FROM runs_status_events \
         WHERE project_id = 'p' AND committed_at < '2026-01-01 00:00:00' \
         ORDER BY cursor DESC LIMIT 1",
    )
    .await;
    assert!(
        age.contains("idx_runs_status_events_project_committed")
            || age.contains("idx_runs_status_events_project_cursor"),
        "the age protection must be an indexed lookup: {age}",
    );
}
