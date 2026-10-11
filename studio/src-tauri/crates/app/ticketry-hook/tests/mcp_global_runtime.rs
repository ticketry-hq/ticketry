use serde_json::json;
use std::time::{Duration, Instant};
use ticketry_data_directory::DataDirectoryGuard;

#[path = "mcp_global_runtime/bridge.rs"]
mod bridge;
#[path = "mcp_global_runtime/fixture.rs"]
mod fixture;
#[path = "../../../../tests/common/mcp_database.rs"]
mod mcp_database;

use bridge::{runtime, Bridge};

#[tokio::test]
async fn global_bridge_initializes_without_run_or_authorization() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    mcp_database::prepare_command_database(&directory).await;
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let listener = runtime(directory.path(), &guard).await;
    let mut bridge = Bridge::start(directory.path());
    bridge.initialize().await;
    let response = bridge.call(1, "list_projects", json!({})).await;
    assert_eq!(
        response["result"]["structuredContent"]["result"][0]["id"],
        ticketry_mcp::PROJECT,
        "{response}"
    );
    bridge.close().await;
    listener.shutdown().await;
}

#[tokio::test]
async fn global_bridge_lists_every_project_and_reads_work_in_another_project() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    mcp_database::prepare_command_database(&directory).await;
    fixture::add_other_project(directory.path()).await;
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let listener = runtime(directory.path(), &guard).await;
    let mut bridge = Bridge::start(directory.path());
    bridge.initialize().await;

    let projects = bridge.call(1, "list_projects", json!({})).await;
    let projects = projects["result"]["structuredContent"]["result"]
        .as_array()
        .unwrap();
    assert_eq!(projects.len(), 2, "{projects:?}");
    for project in [ticketry_mcp::PROJECT, fixture::OTHER_PROJECT] {
        assert!(
            projects.iter().any(|row| row["id"] == project),
            "{projects:?}"
        );
    }
    let details = bridge
        .call(2, "get_task_details", json!({"id_or_key":"OTHER-42"}))
        .await;
    let task = &details["result"]["structuredContent"]["result"];
    assert_eq!(task["name"], "Cross-project work", "{details}");
    assert_eq!(task["key"], "OTHER-42", "{details}");
    assert_eq!(task["project_id"], fixture::OTHER_PROJECT, "{details}");

    bridge.close().await;
    listener.shutdown().await;
}

#[tokio::test]
async fn global_bridge_obeys_agent_workflow_permissions_and_refuses_run_termination() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    mcp_database::prepare_command_database(&directory).await;
    fixture::add_human_only_return_transition(directory.path()).await;
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let listener = runtime(directory.path(), &guard).await;
    let mut bridge = Bridge::start(directory.path());
    bridge.initialize().await;

    let allowed = bridge
        .call(
            1,
            "update_task_status",
            json!({
                "project_id":ticketry_mcp::PROJECT,"task_id":"AUTH-900","status_name":"Validation"
            }),
        )
        .await;
    assert_eq!(
        allowed["result"]["structuredContent"]["ok"], true,
        "{allowed}"
    );
    let denied = bridge
        .call(
            2,
            "update_task_status",
            json!({
                "project_id":ticketry_mcp::PROJECT,"task_id":"AUTH-900","status_name":"Building"
            }),
        )
        .await;
    assert_eq!(
        denied["result"]["structuredContent"]["ok"], false,
        "{denied}"
    );
    assert_eq!(
        denied["result"]["structuredContent"]["code"], "human_only_transition",
        "{denied}"
    );
    let details = bridge
        .call(3, "get_task_details", json!({"id_or_key":"AUTH-900"}))
        .await;
    assert_eq!(
        details["result"]["structuredContent"]["result"]["state_id"],
        fixture::VALIDATION,
        "{details}"
    );
    let termination = bridge.call(4, "terminate_current_run", json!({})).await;
    assert_eq!(
        termination["result"]["structuredContent"]["reason"], "authorization_missing",
        "{termination}"
    );

    bridge.close().await;
    listener.shutdown().await;
}

#[tokio::test]
async fn global_bridge_recovers_from_offline_start_and_replays_initialize_after_restart() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    mcp_database::prepare_command_database(&directory).await;
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let mut bridge = Bridge::start(directory.path());

    let started = Instant::now();
    let offline = bridge.call(1, "list_projects", json!({})).await;
    assert_eq!(offline["error"]["code"], -32001, "{offline}");
    assert_eq!(
        offline["error"]["data"]["code"], "service_unavailable",
        "{offline}"
    );
    assert!(started.elapsed() < Duration::from_secs(1));

    let listener = runtime(directory.path(), &guard).await;
    bridge.initialize().await;
    bridge.recovered(100).await;
    listener.shutdown().await;

    let started = Instant::now();
    let outage = bridge.call(2, "append_description", json!({
        "project_id":ticketry_mcp::PROJECT,"task_id":"AUTH-900","new_content":"Must never be replayed"
    })).await;
    assert_eq!(outage["error"]["code"], -32001, "{outage}");
    assert!(started.elapsed() < Duration::from_secs(1));

    let restarted = runtime(directory.path(), &guard).await;
    // No second provider initialize: successful tool calls require the bridge's cached replay.
    bridge.recovered(200).await;
    let details = bridge
        .call(3, "get_task_details", json!({"id_or_key":"AUTH-900"}))
        .await;
    assert_eq!(
        details["result"]["structuredContent"]["result"]["description"], "",
        "{details}"
    );
    let termination = bridge.call(4, "terminate_current_run", json!({})).await;
    assert_eq!(
        termination["result"]["structuredContent"]["reason"], "authorization_missing",
        "{termination}"
    );

    bridge.close().await;
    restarted.shutdown().await;
}
