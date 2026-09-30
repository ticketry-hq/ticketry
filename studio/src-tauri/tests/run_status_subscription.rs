//! The production path: the generated GraphQL subscription served over the
//! TauRPC transport Studio actually uses.

use std::time::Duration;

use sea_orm::DatabaseConnection;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_graphql::{GraphQlEndpoint, TransportApi, TransportApiImpl};
use ticketry_runs::{failure_code, LifecycleFact, RunsServices};

mod common;
use common::runs_status_fixture::{insert_run, PUBLIC_PROJECT, TASK};

const DOCUMENT: &str = r#"
subscription RunStatusStream($projectId: String!, $afterCursor: Int) {
  run_status_stream(project_id: $projectId, after_cursor: $afterCursor) {
    __typename
    ... on RunStatusSnapshot { project_id cursor at runs { agent_run_id state } }
    ... on RunStatusEvent { cursor event_id project_id event_kind payload_version payload }
    ... on RunStatusCaughtUp { project_id cursor }
    ... on RunStatusResetRequired { project_id cursor reason }
    ... on RunStatusFailed { code message }
  }
}
"#;

async fn installed() -> (tempfile::TempDir, DatabaseConnection, TransportApiImpl) {
    let (directory, database) = common::runs_status_fixture::open().await;
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("build the foundation schema with the status subscription");
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .expect("install the endpoint");
    (directory, database, api)
}

fn capture() -> (
    Channel<String>,
    tokio::sync::mpsc::UnboundedReceiver<String>,
) {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let channel = Channel::new(move |message: InvokeResponseBody| {
        let InvokeResponseBody::Json(encoded) = message else {
            panic!("subscription events must cross as JSON");
        };
        let event: String = serde_json::from_str(&encoded).expect("decode the channel payload");
        let _ = sender.send(event);
        Ok(())
    });
    (channel, receiver)
}

async fn next_frame(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
) -> serde_json::Value {
    next_frame_within(receiver, Duration::from_secs(10)).await
}

async fn next_frame_within(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
    deadline: Duration,
) -> serde_json::Value {
    let event = tokio::time::timeout(deadline, receiver.recv())
        .await
        .expect("a subscription event arrives before the deadline")
        .expect("the subscription channel stays open");
    let envelope: serde_json::Value =
        serde_json::from_str(&event).expect("decode the event envelope");
    assert_eq!(envelope["type"], "next", "received {envelope}");
    assert!(
        envelope["payload"]["errors"].is_null(),
        "the frame carries no transport error: {envelope}"
    );
    envelope["payload"]["data"]["run_status_stream"].clone()
}

#[tokio::test]
async fn a_committed_event_wakes_the_listener_before_the_safety_reread() {
    let (_directory, database, api) = installed().await;
    insert_run(&database, "run-wakeup", TASK, "2026-08-16T10:00:00Z").await;
    let (channel, mut frames) = capture();

    api.clone()
        .graphql_subscribe(
            "status-wakeup".to_owned(),
            request(PUBLIC_PROJECT, None),
            channel,
        )
        .await;
    assert_eq!(
        next_frame(&mut frames).await["__typename"],
        "RunStatusSnapshot"
    );
    assert_eq!(
        next_frame(&mut frames).await["__typename"],
        "RunStatusCaughtUp"
    );

    RunsServices::new(database)
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run-wakeup".to_owned(),
            kind: "turn_start".to_owned(),
            occurred_at: "2026-08-16T10:01:00Z".to_owned(),
            provider_session_id: None,
        })
        .await
        .expect("the lifecycle fact commits");

    let event = next_frame_within(&mut frames, Duration::from_millis(500)).await;
    assert_eq!(event["__typename"], "RunStatusEvent");
    assert_eq!(event["event_kind"], "agent_run.lifecycle");

    api.graphql_unsubscribe("status-wakeup".to_owned()).await;
}

fn request(project_id: &str, after_cursor: Option<i64>) -> String {
    serde_json::json!({
        "query": DOCUMENT,
        "operationName": "RunStatusStream",
        "variables": { "projectId": project_id, "afterCursor": after_cursor },
    })
    .to_string()
}

#[tokio::test]
async fn the_generated_subscription_publishes_the_typed_union_over_taurpc() {
    let (_directory, database, api) = installed().await;
    insert_run(&database, "run-a", TASK, "2026-08-16T10:00:00Z").await;
    let (channel, mut frames) = capture();

    let accepted = api
        .clone()
        .graphql_subscribe(
            "status-1".to_owned(),
            request(PUBLIC_PROJECT, None),
            channel,
        )
        .await;
    assert_eq!(accepted, r#"{"type":"accepted"}"#);

    let snapshot = next_frame(&mut frames).await;
    assert_eq!(snapshot["__typename"], "RunStatusSnapshot");
    assert_eq!(snapshot["project_id"], PUBLIC_PROJECT);
    assert_eq!(snapshot["runs"][0]["agent_run_id"], "run-a");
    let caught_up = next_frame(&mut frames).await;
    assert_eq!(caught_up["__typename"], "RunStatusCaughtUp");

    RunsServices::new(database.clone())
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run-a".to_owned(),
            kind: "turn_start".to_owned(),
            occurred_at: "2026-08-16T10:01:00Z".to_owned(),
            provider_session_id: None,
        })
        .await
        .expect("the lifecycle fact commits");

    let event = next_frame(&mut frames).await;
    assert_eq!(event["__typename"], "RunStatusEvent");
    assert_eq!(event["event_kind"], "agent_run.lifecycle");
    assert_eq!(event["payload_version"], 1);
    assert_eq!(event["payload"]["state"], "working");
    assert!(
        event["cursor"].as_i64().expect("a signed cursor")
            > caught_up["cursor"].as_i64().expect("a signed cursor")
    );

    assert!(api.clone().graphql_unsubscribe("status-1".to_owned()).await);
    assert!(
        !api.clone().graphql_unsubscribe("status-1".to_owned()).await,
        "cancellation leaves no stale registry entry"
    );
}

#[tokio::test]
async fn a_structured_failure_frame_carries_a_code_and_no_storage_detail() {
    let (_directory, _database, api) = installed().await;
    let (channel, mut frames) = capture();

    api.clone()
        .graphql_subscribe(
            "status-bad".to_owned(),
            request("not-a-project", None),
            channel,
        )
        .await;

    let failure = next_frame(&mut frames).await;
    assert_eq!(failure["__typename"], "RunStatusFailed");
    assert_eq!(failure["code"], failure_code::BAD_REQUEST);
    let message = failure["message"].as_str().expect("a message");
    for leak in ["runs_status_events", "sqlite", "/", "SELECT"] {
        assert!(!message.contains(leak), "message leaks {leak}: {message}");
    }
}

#[tokio::test]
async fn the_transport_bounds_subscription_identities_and_duplicates() {
    let (_directory, _database, api) = installed().await;
    let (channel, _frames) = capture();
    api.clone()
        .graphql_subscribe(
            "status-1".to_owned(),
            request(PUBLIC_PROJECT, None),
            channel,
        )
        .await;

    let (duplicate, _ignored) = capture();
    let response = api
        .clone()
        .graphql_subscribe(
            "status-1".to_owned(),
            request(PUBLIC_PROJECT, None),
            duplicate,
        )
        .await;
    assert!(
        response.contains("already active"),
        "a reused subscription id is refused: {response}"
    );

    let (invalid, _also_ignored) = capture();
    let response = api
        .clone()
        .graphql_subscribe(
            "status 1!".to_owned(),
            request(PUBLIC_PROJECT, None),
            invalid,
        )
        .await;
    assert!(
        response.contains("bad_request"),
        "an invalid subscription id is refused: {response}"
    );
    api.clone().graphql_unsubscribe("status-1".to_owned()).await;
}

#[tokio::test]
async fn a_status_stream_without_installed_runs_services_reports_unavailable() {
    let (_directory, database) = common::runs_status_fixture::open().await;
    // The probe schema installs no Runs services, which is how Studio can
    // reach the transport before adoption completes.
    let schema = ticketry_graphql_schema::foundation_schema(
        database, None, None, None, None, None, None, None, None,
    )
    .expect("build the schema without Runs services");
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(schema)).unwrap();
    let (channel, mut frames) = capture();

    api.clone()
        .graphql_subscribe(
            "status-1".to_owned(),
            request(PUBLIC_PROJECT, None),
            channel,
        )
        .await;

    let failure = next_frame(&mut frames).await;
    assert_eq!(failure["__typename"], "RunStatusFailed");
    assert_eq!(failure["code"], failure_code::UNAVAILABLE);
}
