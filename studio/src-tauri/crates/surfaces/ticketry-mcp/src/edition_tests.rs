//! What each edition's MCP clients are offered, observed through the socket.

use serde_json::{json, Value};
use ticketry_edition::{Edition, EDITION};

use super::test_support::{SocketClient, PROJECT};
use super::tests::{own, prepare_projects, start};
use super::*;

/// Every tool both editions publish, in registry order. Core inserts its
/// sprint tools at the marked positions.
const POCOCK_TOOLS: [&str; 33] = [
    "mcp_ping",
    "terminate_current_run",
    "add_issue_type_workflow_transition",
    "add_task_blocker",
    "add_task_dependent",
    "add_task_tags",
    "append_task_description",
    "attach_file",
    "clear_issue_type_workflow_launch_binding",
    "create_review_finding",
    "create_sub_task",
    "create_task",
    "execute_dependency_graph",
    "get_dependency_graph",
    "get_issue_type_workflow_settings",
    "get_task_details",
    "get_task_scope_context",
    "launch_default_coding_agent",
    "list_issue_types",
    "list_modules",
    "list_projects",
    "list_tasks",
    "remove_issue_type_workflow_transition",
    "rename_codex_thread",
    "reparent_tasks",
    "run_now",
    "set_issue_type_workflow_auto_start",
    "set_issue_type_workflow_start_state",
    "set_issue_type_workflow_transition_permission",
    "set_task_blockers",
    "update_task",
    "update_task_status",
    "upsert_issue_type_workflow_launch_binding",
];

const CORE_TOOLS: [&str; 36] = [
    "mcp_ping",
    "terminate_current_run",
    "add_issue_type_workflow_transition",
    "add_task_blocker",
    "add_task_dependent",
    "add_task_tags",
    "append_task_description",
    "attach_file",
    "clear_issue_type_workflow_launch_binding",
    "create_review_finding",
    "create_sub_task",
    "create_task",
    "execute_dependency_graph",
    "get_dependency_graph",
    "get_issue_type_workflow_settings",
    "get_sprint_goals",
    "get_task_details",
    "get_task_scope_context",
    "launch_default_coding_agent",
    "list_issue_types",
    "list_modules",
    "list_projects",
    "list_sprints",
    "list_tasks",
    "remove_issue_type_workflow_transition",
    "rename_codex_thread",
    "reparent_tasks",
    "run_now",
    "set_issue_type_workflow_auto_start",
    "set_issue_type_workflow_start_state",
    "set_issue_type_workflow_transition_permission",
    "set_task_blockers",
    "suggest_sprint_story",
    "update_task",
    "update_task_status",
    "upsert_issue_type_workflow_launch_binding",
];

fn expected_tools() -> &'static [&'static str] {
    match EDITION {
        Edition::Pocock => &POCOCK_TOOLS,
        Edition::Core => &CORE_TOOLS,
    }
}

async fn listed_tools(client: &mut SocketClient) -> Vec<Value> {
    let listed = client
        .request(json!({"jsonrpc":"2.0","id":"list","method":"tools/list","params":{}}))
        .await;
    listed["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("tools/list failed: {listed:#}"))
        .clone()
}

fn names(tools: &[Value]) -> Vec<&str> {
    tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect()
}

fn schema<'a>(tools: &'a [Value], name: &str) -> &'a Value {
    &tools
        .iter()
        .find(|tool| tool["name"] == name)
        .unwrap_or_else(|| panic!("{name} is not listed"))["inputSchema"]
}

fn description<'a>(tools: &'a [Value], name: &str) -> &'a str {
    tools
        .iter()
        .find(|tool| tool["name"] == name)
        .and_then(|tool| tool["description"].as_str())
        .unwrap_or_else(|| panic!("{name} has no description"))
}

#[tokio::test]
async fn global_and_run_connections_list_exactly_the_editions_tools_in_order() {
    eprintln!("compiled edition: {}", EDITION.name());
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();

    let mut global = SocketClient::connect_global(runtime.socket_path()).await;
    let global_tools = listed_tools(&mut global).await;
    assert_eq!(names(&global_tools), expected_tools());

    // A run's grant is minted from the same edition-filtered list, so the run
    // sees exactly what a global client sees.
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    let run_tools = listed_tools(&mut run).await;
    assert_eq!(names(&run_tools), expected_tools());
    assert_eq!(
        allowed_provider_operations(),
        expected_tools()
            .iter()
            .map(|name| (*name).to_owned())
            .chain(std::iter::once("provider_lifecycle".to_owned()))
            .collect::<Vec<_>>()
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn editions_without_sprint_planning_withhold_and_refuse_the_sprint_argument() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;
    let tools = listed_tools(&mut global).await;
    let sprint_planning =
        ticketry_edition::has(ticketry_edition::EditionCapability::SprintPlanning);

    for name in ["create_task", "create_sub_task", "update_task"] {
        let published = schema(&tools, name)["properties"].get("sprint").is_some();
        assert_eq!(published, sprint_planning, "{name} sprint property");
        let wording = description(&tools, name).to_lowercase();
        assert_eq!(
            wording.contains("sprint"),
            sprint_planning,
            "{name}: {wording}"
        );
    }
    if sprint_planning {
        runtime.shutdown().await;
        return;
    }

    let supplied = [
        (
            "create_task",
            json!({"project_id": PROJECT, "name": "Sprinted", "issue_type": "Story", "sprint": "current"}),
        ),
        (
            "create_sub_task",
            json!({"project_id": PROJECT, "parent_id": "AUTH-1", "name": "Sprinted", "issue_type": "Story", "sprint": "next"}),
        ),
        (
            "update_task",
            json!({"id_or_key": "AUTH-1", "sprint": null}),
        ),
    ];
    for (id, (name, arguments)) in (1..).zip(supplied) {
        let refused = global.structured(id, name, arguments).await;
        assert_eq!(refused["ok"], false, "{name}: {refused:#}");
        assert_eq!(
            refused["code"], "edition_capability_unavailable",
            "{name}: {refused:#}"
        );
        assert_eq!(refused["field"], "sprint", "{name}: {refused:#}");
    }
    let tasks = global
        .structured(10, "list_tasks", json!({"project_id": PROJECT}))
        .await;
    assert_eq!(
        tasks["result"].as_array().map(Vec::len),
        Some(1),
        "{tasks:#}"
    );

    let withheld = global
        .call(11, "list_sprints", json!({"project_id": PROJECT}))
        .await;
    assert!(withheld["error"].is_object(), "{withheld:#}");

    runtime.shutdown().await;
}
