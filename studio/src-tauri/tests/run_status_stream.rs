//! Snapshot, replay, and live delivery for the project status subscription.
//!
//! Assertions are about what a controlled client can observe: frame order,
//! cursor monotonicity, project scope, and terminal outcomes. Nothing here
//! inspects the stream's internal phases.

use std::time::Duration;

use futures_util::{Stream, StreamExt};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use ticketry_runs::persistence::{
    failure_code, open_status_stream, reset_reason, LifecycleFact, RunStatusFrame, RunsServices,
    StatusStreamRequest, TerminalFact, TerminalOutcome,
};

mod common;
use common::runs_status_fixture::{
    insert_event, insert_run, insert_run_with_launch_snapshot, FOREIGN_PROJECT, PROJECT,
    PUBLIC_FOREIGN_PROJECT, PUBLIC_PROJECT, TASK,
};

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, RunsServices) {
    let (directory, database) = common::runs_status_fixture::open().await;
    let services = RunsServices::new(database.clone());
    (directory, database, services)
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
        let frame = tokio::time::timeout(Duration::from_secs(10), stream.next())
            .await
            .expect("a status frame arrives within ten seconds")
            .expect("the status stream stays open");
        frames.push(frame);
    }
    frames
}

fn cursors(frames: &[RunStatusFrame]) -> Vec<i64> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            RunStatusFrame::RunStatusEvent(event) => Some(event.cursor),
            _ => None,
        })
        .collect()
}

fn kinds(frames: &[RunStatusFrame]) -> Vec<&str> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            RunStatusFrame::RunStatusEvent(event) => Some(event.event_kind.as_str()),
            _ => None,
        })
        .collect()
}

fn holding<'a>(
    rows: &'a [ticketry_runs::persistence::AgentRunHolding],
    id: &str,
) -> &'a ticketry_runs::persistence::AgentRunHolding {
    rows.iter().find(|run| run.agent_run_id == id).unwrap()
}

async fn high_water(services: &RunsServices) -> i64 {
    services
        .outbox()
        .events()
        .high_water()
        .await
        .expect("read the outbox high-water cursor")
}

async fn commit_lifecycle(services: &RunsServices, run_id: &str, kind: &str, at: &str) {
    services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: run_id.to_owned(),
            kind: kind.to_owned(),
            occurred_at: at.to_owned(),
            provider_session_id: None,
        })
        .await
        .expect("the lifecycle fact commits");
}

async fn insert_terminal_baseline(database: &DatabaseConnection, run_id: &str, observed_at: &str) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope, runtime_cleanup_pending, output_sequence, last_output_at) VALUES (?, ?, ?, ?, ?, ?, 'task', 0, 0, ?)",
            [
                run_id.into(),
                format!("pt-{run_id}").into(),
                TASK.into(),
                common::runs_status_fixture::MODULE.into(),
                common::runs_status_fixture::PROJECT.into(),
                observed_at.into(),
                observed_at.into(),
            ],
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn snapshot_projects_the_inclusive_stall_boundary_with_outcome_precedence() {
    let (_directory, database, services) = fixture().await;
    for run_id in ["run-live", "run-waiting", "run-ended"] {
        insert_run(&database, run_id, TASK, "2026-08-20T10:00:00Z").await;
        insert_terminal_baseline(&database, run_id, "2026-08-20T10:00:00Z").await;
    }
    commit_lifecycle(
        &services,
        "run-waiting",
        "awaiting_input",
        "2026-08-20T10:00:30Z",
    )
    .await;
    services
        .lifecycle()
        .apply_terminal_fact(TerminalFact {
            agent_run_id: "run-ended".to_owned(),
            outcome: TerminalOutcome::Terminated,
            occurred_at: "2026-08-20T10:00:30Z".to_owned(),
            exit_code: None,
        })
        .await
        .unwrap();

    let before = services
        .queries()
        .run_holdings_at(PUBLIC_PROJECT, None, "2026-08-20T10:00:59Z")
        .await
        .unwrap();
    let boundary = services
        .queries()
        .run_holdings_at(PUBLIC_PROJECT, None, "2026-08-20T10:01:00Z")
        .await
        .unwrap();
    assert_eq!(holding(&before, "run-live").state, "unknown");
    assert_eq!(holding(&before, "run-live").effective_state, "unknown");
    assert_eq!(holding(&boundary, "run-live").state, "unknown");
    assert_eq!(holding(&boundary, "run-live").effective_state, "stalled");
    assert_eq!(
        holding(&boundary, "run-waiting").effective_state,
        "needs_input"
    );
    assert_eq!(holding(&boundary, "run-ended").effective_state, "exited");
}

#[tokio::test]
async fn lifecycle_event_and_snapshot_share_the_effective_stall_projection() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-effective", TASK, "2026-08-20T10:00:00Z").await;
    insert_terminal_baseline(&database, "run-effective", "2026-08-20T10:00:00Z").await;

    commit_lifecycle(
        &services,
        "run-effective",
        "turn_start",
        "2026-08-20T10:01:00Z",
    )
    .await;
    let payload: String = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT payload FROM runs_status_events ORDER BY cursor DESC LIMIT 1".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "payload")
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(&payload).unwrap();
    let snapshot = services
        .queries()
        .run_holdings_at(PUBLIC_PROJECT, None, "2026-08-20T10:01:00Z")
        .await
        .unwrap();

    assert_eq!(event["state"], "working");
    assert_eq!(event["effectiveState"], "stalled");
    assert_eq!(holding(&snapshot, "run-effective").state, "working");
    assert_eq!(
        holding(&snapshot, "run-effective").effective_state,
        "stalled"
    );
}

#[tokio::test]
async fn a_fresh_subscriber_is_baselined_at_the_high_water_cursor_and_then_goes_live() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:01:00Z").await;

    let mut stream = Box::pin(open_status_stream(services.stream(), request(None)));
    let opening = take(&mut stream, 2).await;

    let RunStatusFrame::RunStatusSnapshot(snapshot) = &opening[0] else {
        panic!("the snapshot is the first frame, received {:?}", opening[0]);
    };
    assert_eq!(snapshot.project_id, PUBLIC_PROJECT);
    assert_eq!(snapshot.runs.len(), 1);
    assert_eq!(snapshot.runs[0].state, "working");
    let baseline = snapshot.cursor;
    assert!(baseline > 0, "the committed lifecycle event set a cursor");
    let RunStatusFrame::RunStatusCaughtUp(caught_up) = &opening[1] else {
        panic!("caught-up follows the snapshot, received {:?}", opening[1]);
    };
    assert_eq!(caught_up.cursor, baseline);

    // A fresh subscriber replays nothing; only facts above the baseline stream.
    commit_lifecycle(&services, "run-a", "awaiting_input", "2026-08-16T10:02:00Z").await;
    let live = take(&mut stream, 1).await;
    let RunStatusFrame::RunStatusEvent(event) = &live[0] else {
        panic!("a durable event follows caught-up, received {:?}", live[0]);
    };
    assert_eq!(event.event_kind, "agent_run.lifecycle");
    assert!(event.cursor > baseline);
    assert_eq!(event.project_id, PUBLIC_PROJECT);
    assert_eq!(event.payload.0["state"], "needs_input");
}

#[tokio::test]
async fn snapshots_and_live_events_publish_the_same_immutable_launch_metadata() {
    let (_directory, database, services) = fixture().await;
    insert_run_with_launch_snapshot(
        &database,
        "run-snapshot",
        TASK,
        "2026-08-16T10:00:00Z",
        "Implement",
        "gpt-5.6",
    )
    .await;
    let mut stream = Box::pin(open_status_stream(services.stream(), request(None)));
    let opening = take(&mut stream, 2).await;
    let RunStatusFrame::RunStatusSnapshot(snapshot) = &opening[0] else {
        panic!("the first frame is a snapshot");
    };
    assert_eq!(snapshot.runs[0].launch_state.as_deref(), Some("Implement"));
    assert_eq!(snapshot.runs[0].launch_model.as_deref(), Some("gpt-5.6"));

    commit_lifecycle(
        &services,
        "run-snapshot",
        "turn_start",
        "2026-08-16T10:01:00Z",
    )
    .await;
    let live = take(&mut stream, 1).await;
    let RunStatusFrame::RunStatusEvent(event) = &live[0] else {
        panic!("the lifecycle update is a durable event");
    };
    assert_eq!(event.payload.0["launchState"], "Implement");
    assert_eq!(event.payload.0["launchModel"], "gpt-5.6");
}

#[tokio::test]
async fn a_resumed_subscriber_replays_after_its_cursor_through_high_water_in_cursor_order() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    commit_lifecycle(&services, "run-a", "session_start", "2026-08-16T10:01:00Z").await;
    let retained = high_water(&services).await;
    commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:02:00Z").await;
    commit_lifecycle(&services, "run-a", "awaiting_input", "2026-08-16T10:03:00Z").await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(retained)),
    ));
    let opening = take(&mut stream, 4).await;

    assert!(matches!(opening[0], RunStatusFrame::RunStatusSnapshot(_)));
    let replayed = cursors(&opening);
    assert_eq!(replayed.len(), 2, "both missed facts replay");
    assert!(replayed[0] < replayed[1], "replay is in cursor order");
    assert!(
        replayed[0] > retained,
        "replay starts after the retained cursor"
    );
    let RunStatusFrame::RunStatusCaughtUp(caught_up) = &opening[3] else {
        panic!("caught-up closes the replay, received {:?}", opening[3]);
    };
    assert_eq!(caught_up.cursor, replayed[1]);
}

#[tokio::test]
async fn a_fact_committed_at_any_handshake_boundary_is_delivered_exactly_once() {
    for boundary_delay in [0_u64, 1, 3, 7, 15] {
        let (_directory, database, services) = fixture().await;
        insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
        commit_lifecycle(&services, "run-a", "session_start", "2026-08-16T10:01:00Z").await;
        let retained = high_water(&services).await;

        let writer = services.clone();
        let commit = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(boundary_delay)).await;
            commit_lifecycle(&writer, "run-a", "turn_start", "2026-08-16T10:02:00Z").await;
        });
        let mut stream = Box::pin(open_status_stream(
            services.stream(),
            request(Some(retained)),
        ));
        // Snapshot, the boundary fact, and caught-up may interleave, so the
        // assertion is about the whole opening window rather than one index.
        let opening = take(&mut stream, 3).await;
        commit.await.unwrap();

        assert!(
            matches!(opening[0], RunStatusFrame::RunStatusSnapshot(_)),
            "the snapshot is always first at boundary {boundary_delay}ms"
        );
        let delivered = cursors(&opening);
        assert_eq!(
            delivered.len(),
            1,
            "the boundary fact is delivered exactly once at {boundary_delay}ms"
        );
        assert!(delivered[0] > retained);
        assert_eq!(kinds(&opening), vec!["agent_run.lifecycle"]);
    }
}

#[tokio::test]
async fn one_projects_events_never_reach_another_and_global_cursor_gaps_are_valid() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    let retained = high_water(&services).await;
    insert_event(&database, FOREIGN_PROJECT, "agent_run.lifecycle", 1, "{}").await;
    commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:01:00Z").await;
    insert_event(&database, FOREIGN_PROJECT, "agent_run.lifecycle", 1, "{}").await;
    commit_lifecycle(&services, "run-a", "awaiting_input", "2026-08-16T10:02:00Z").await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(retained)),
    ));
    let opening = take(&mut stream, 4).await;

    let delivered = cursors(&opening);
    assert_eq!(
        delivered.len(),
        2,
        "only this project's facts are delivered"
    );
    assert!(
        delivered[1] - delivered[0] > 1,
        "a gap left by another project is valid, received {delivered:?}"
    );
    for frame in &opening {
        if let RunStatusFrame::RunStatusEvent(event) = frame {
            assert_eq!(event.project_id, PUBLIC_PROJECT);
        }
    }

    // A foreign subscriber sees its own history and none of this project's.
    let mut foreign = Box::pin(open_status_stream(
        services.stream(),
        StatusStreamRequest {
            project_id: PUBLIC_FOREIGN_PROJECT.to_owned(),
            after_cursor: Some(retained),
        },
    ));
    let foreign_opening = take(&mut foreign, 4).await;
    for frame in &foreign_opening {
        if let RunStatusFrame::RunStatusEvent(event) = frame {
            assert_eq!(event.project_id, PUBLIC_FOREIGN_PROJECT);
        }
    }
    assert_eq!(cursors(&foreign_opening).len(), 2);
}

#[tokio::test]
async fn a_compacted_cursor_requires_reset_rather_than_a_partial_history() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:01:00Z").await;
    let compacted_through = high_water(&services).await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO runs_project_compaction_watermarks (project_id, compacted_through_cursor, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            [PROJECT.into(), compacted_through.into()],
        ))
        .await
        .unwrap();
    commit_lifecycle(&services, "run-a", "awaiting_input", "2026-08-16T10:02:00Z").await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(compacted_through - 1)),
    ));
    let opening = take(&mut stream, 3).await;

    let RunStatusFrame::RunStatusResetRequired(reset) = &opening[1] else {
        panic!("a compacted cursor resets, received {:?}", opening[1]);
    };
    assert_eq!(reset.reason, reset_reason::COMPACTED);
    assert_eq!(reset.project_id, PUBLIC_PROJECT);
    assert!(
        cursors(&opening).is_empty(),
        "a reset publishes no partial history"
    );
    let RunStatusFrame::RunStatusCaughtUp(caught_up) = &opening[2] else {
        panic!("the reset installs a baseline, received {:?}", opening[2]);
    };
    assert_eq!(caught_up.cursor, reset.cursor);

    // Only facts above the installed baseline follow.
    commit_lifecycle(&services, "run-a", "idle", "2026-08-16T10:03:00Z").await;
    let live = take(&mut stream, 1).await;
    assert!(cursors(&live)[0] > caught_up.cursor);
}

#[tokio::test]
async fn a_cursor_ahead_of_the_server_requires_reset() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:01:00Z").await;
    let high_water = high_water(&services).await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(high_water + 5_000)),
    ));
    let opening = take(&mut stream, 3).await;

    let RunStatusFrame::RunStatusResetRequired(reset) = &opening[1] else {
        panic!(
            "a cursor ahead of the server resets, received {:?}",
            opening[1]
        );
    };
    assert_eq!(reset.reason, reset_reason::AHEAD_OF_SERVER);
    assert_eq!(reset.cursor, high_water);
}

#[tokio::test]
async fn an_unsupported_event_version_in_replay_requires_a_reset() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    let retained = high_water(&services).await;
    insert_event(&database, PROJECT, "agent_run.lifecycle", 99, "{}").await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(retained)),
    ));
    let opening = take(&mut stream, 3).await;

    // Recovery is possible, so the client is told to refetch and rebaseline
    // rather than being stalled against history it will never be able to read.
    let RunStatusFrame::RunStatusResetRequired(reset) = &opening[1] else {
        panic!("an unreadable version resets, received {:?}", opening[1]);
    };
    assert_eq!(reset.reason, reset_reason::EVENT_VERSION_INCOMPATIBLE);
    assert!(
        matches!(&opening[2], RunStatusFrame::RunStatusCaughtUp(caught_up)
            if caught_up.cursor == reset.cursor),
        "the reset installs the server's high-water baseline",
    );
}

#[tokio::test]
async fn an_unsupported_event_version_after_catch_up_ends_the_stream_with_a_structured_failure() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;

    let mut stream = Box::pin(open_status_stream(services.stream(), request(None)));
    take(&mut stream, 2).await;
    // Committed above the installed baseline, so no reset cursor could recover
    // it: the row this build cannot read is the live frontier itself.
    insert_event(&database, PROJECT, "agent_run.lifecycle", 99, "{}").await;

    let frames = take(&mut stream, 1).await;
    let RunStatusFrame::RunStatusFailed(failure) = &frames[0] else {
        panic!("an unreadable live version fails, received {:?}", frames[0]);
    };
    assert_eq!(failure.code, failure_code::EVENT_VERSION);
    assert!(
        !failure.message.contains("runs_status_events"),
        "structured failures do not leak storage detail: {}",
        failure.message
    );
    assert!(stream.next().await.is_none(), "the failure is terminal");
}

#[tokio::test]
async fn an_invalid_project_or_backwards_cursor_fails_before_any_snapshot() {
    let (_directory, _database, services) = fixture().await;

    for (project_id, after_cursor) in [
        ("not-a-project".to_owned(), None),
        (PUBLIC_PROJECT.to_owned(), Some(-1)),
    ] {
        let mut stream = Box::pin(open_status_stream(
            services.stream(),
            StatusStreamRequest {
                project_id,
                after_cursor,
            },
        ));
        let frames = take(&mut stream, 1).await;
        let RunStatusFrame::RunStatusFailed(failure) = &frames[0] else {
            panic!("a bad request fails first, received {:?}", frames[0]);
        };
        assert_eq!(failure.code, failure_code::BAD_REQUEST);
        assert!(stream.next().await.is_none(), "the failure is terminal");
    }
}

#[tokio::test]
async fn a_lost_wakeup_delays_a_durable_fact_instead_of_dropping_it() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    let retained = high_water(&services).await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(retained)),
    ));
    take(&mut stream, 2).await;

    // Written straight to the outbox: no command runs, so no wake-up is
    // published. The stream must still reread and deliver the fact.
    insert_event(
        &database,
        PROJECT,
        "agent_run.lifecycle",
        1,
        r#"{"state":"working"}"#,
    )
    .await;
    let live = take(&mut stream, 1).await;
    let RunStatusFrame::RunStatusEvent(event) = &live[0] else {
        panic!(
            "an unannounced fact is still delivered, received {:?}",
            live[0]
        );
    };
    assert!(event.cursor > retained);
}

#[tokio::test]
async fn a_terminal_outcome_reaches_subscribers_and_survives_a_reconnect() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    let retained = high_water(&services).await;

    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        request(Some(retained)),
    ));
    take(&mut stream, 2).await;
    services
        .lifecycle()
        .apply_terminal_fact(TerminalFact {
            agent_run_id: "run-a".to_owned(),
            outcome: TerminalOutcome::Exited,
            occurred_at: "2026-08-16T10:05:00Z".to_owned(),
            exit_code: Some(0),
        })
        .await
        .expect("the terminal fact commits");

    let live = take(&mut stream, 1).await;
    let RunStatusFrame::RunStatusEvent(event) = &live[0] else {
        panic!("the terminal fact is delivered, received {:?}", live[0]);
    };
    assert_eq!(event.event_kind, "agent_run.terminal");
    drop(stream);

    // A reconnect converges on the same authoritative holding.
    let mut reconnected = Box::pin(open_status_stream(services.stream(), request(None)));
    let opening = take(&mut reconnected, 2).await;
    let RunStatusFrame::RunStatusSnapshot(snapshot) = &opening[0] else {
        panic!("the reconnect starts with a snapshot");
    };
    assert_eq!(snapshot.runs[0].state, "exited");
}

#[tokio::test]
async fn a_cancelled_subscriber_never_blocks_a_committing_writer() {
    let (_directory, database, services) = fixture().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;

    // Several subscribers open and are abandoned mid-stream. Nothing they hold
    // may keep a later command from committing.
    for _ in 0..8 {
        let mut stream = Box::pin(open_status_stream(services.stream(), request(None)));
        take(&mut stream, 1).await;
        drop(stream);
    }
    let slow = Box::pin(open_status_stream(services.stream(), request(None)));

    tokio::time::timeout(
        Duration::from_secs(10),
        commit_lifecycle(&services, "run-a", "turn_start", "2026-08-16T10:01:00Z"),
    )
    .await
    .expect("a writer commits while subscribers are stalled or cancelled");
    drop(slow);
}
