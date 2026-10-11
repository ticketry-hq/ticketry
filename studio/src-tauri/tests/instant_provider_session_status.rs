//! The first provider-thread capture must reach an already subscribed client.
use std::time::Duration;

use futures_util::StreamExt;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_runs::{
    open_status_stream, LifecycleFact, RunStatusFrame, RunsServices, StatusStreamRequest,
};

#[path = "common/runs_status_fixture.rs"]
mod fixture;

const RUN: &str = "instant-run";
const THREAD: &str = "019e9428-9788-7df0-84cd-755e1b776245";
const PRIVATE: &str = "private-instant-launch-material";

#[tokio::test]
async fn captured_codex_thread_reaches_the_live_status_holding_without_private_launch_material() {
    let (_directory, database) = fixture::open().await;
    fixture::insert_run(&database, RUN, fixture::MODULE, "2026-10-08T10:00:00Z").await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE agent_runs SET scope='instant', initial_prompt=?, cwd=?, error=? WHERE id=?",
            [PRIVATE.into(), PRIVATE.into(), PRIVATE.into(), RUN.into()],
        ))
        .await
        .unwrap();
    let services = RunsServices::new(database.clone());
    let mut stream = Box::pin(open_status_stream(
        services.stream(),
        StatusStreamRequest {
            project_id: fixture::PUBLIC_PROJECT.into(),
            after_cursor: None,
        },
    ));
    let snapshot = tokio::time::timeout(Duration::from_secs(10), stream.next())
        .await
        .unwrap()
        .unwrap();
    let RunStatusFrame::RunStatusSnapshot(snapshot) = snapshot else {
        panic!("a fresh subscriber receives the run snapshot first");
    };
    assert_eq!(snapshot.runs.len(), 1);
    assert_eq!(snapshot.runs[0].agent_run_id, RUN);
    assert_eq!(snapshot.runs[0].provider_session_id, None);
    assert!(matches!(
        stream.next().await.unwrap(),
        RunStatusFrame::RunStatusCaughtUp(_)
    ));

    let accepted = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: RUN.into(),
            kind: "idle".into(),
            occurred_at: "2026-10-08T10:00:01Z".into(),
            provider_session_id: Some(THREAD.into()),
        })
        .await
        .unwrap();
    assert!(accepted.applied);
    let event = tokio::time::timeout(Duration::from_secs(10), stream.next())
        .await
        .unwrap()
        .unwrap();
    let RunStatusFrame::RunStatusEvent(event) = event else {
        panic!("session capture reaches the current subscriber as a live event");
    };
    assert_eq!(event.event_kind, "agent_run.lifecycle");
    assert_eq!(event.agent_run_id.as_deref(), Some(RUN));
    assert_eq!(Some(event.cursor), accepted.event_cursor);
    let payload = event.payload.0;
    assert_eq!(payload["providerSessionCaptured"], true);
    assert_eq!(
        payload["run"]["provider_session_id"], THREAD,
        "the live client needs the concrete thread identity to resolve its provider title"
    );
    assert_eq!(payload["run"]["agent_run_id"], RUN);
    assert_eq!(payload["run"]["scope"], "instant");
    assert_eq!(payload["run"]["project_id"], fixture::PUBLIC_PROJECT);
    assert_eq!(
        payload["run"]["module_id"],
        "44444444-4444-4444-4444-444444444444"
    );
    assert_eq!(payload["run"]["task_id"], serde_json::Value::Null);
    let rendered = payload.to_string();
    assert!(!rendered.contains(PRIVATE));
    for protected in ["initial_prompt", "cwd", "error", "conversation_title"] {
        assert!(
            payload["run"].get(protected).is_none(),
            "the published holding excludes protected field {protected}"
        );
    }
}
