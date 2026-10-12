//! Issue-type workflow-policy tools on the typed path: scope, malformed,
//! default and null arguments, observed over the socket exactly as an agent
//! sees them. Well-formed revision-guarded writes against the full command
//! database live in the root package's `mcp_acceptance` binary.

use std::path::Path;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};

use super::super::allowed_provider_operations;
use super::super::test_support::SocketClient;
use super::{own, prepare_projects, start};

const OWN_TYPE: &str = "40000000-0000-0000-0000-000000000000";
const FOREIGN_TYPE: &str = "50000000-0000-0000-0000-000000000000";
const STATE: &str = "60000000-0000-0000-0000-000000000000";
const OTHER_STATE: &str = "60000000-0000-0000-0000-000000000001";

const POLICY_TOOLS: [&str; 7] = [
    "add_issue_type_workflow_transition",
    "remove_issue_type_workflow_transition",
    "set_issue_type_workflow_transition_permission",
    "set_issue_type_workflow_start_state",
    "set_issue_type_workflow_auto_start",
    "clear_issue_type_workflow_launch_binding",
    "upsert_issue_type_workflow_launch_binding",
];

async fn add_foreign_type(directory: &Path) {
    let database = Database::connect(format!("sqlite:{}", directory.join("state.db").display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO worktracker_issuetype VALUES
                ('50000000000000000000000000000000',
                 '20000000000000000000000000000000', 'Story', 'task', '', 0,
                 NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}

/// Well-formed arguments for `tool` against `type_id`.
fn well_formed(tool: &str, type_id: &str) -> Value {
    match tool {
        "add_issue_type_workflow_transition"
        | "remove_issue_type_workflow_transition"
        | "set_issue_type_workflow_transition_permission" => json!({
            "type_id": type_id, "from_state_id": STATE, "to_state_id": OTHER_STATE,
            "workflow_revision": 0,
        }),
        "set_issue_type_workflow_auto_start" => json!({
            "type_id": type_id, "state_id": STATE, "auto_start": true, "workflow_revision": 0,
        }),
        _ => json!({"type_id": type_id, "state_id": STATE, "workflow_revision": 0}),
    }
}

fn with(mut arguments: Value, key: &str, value: Value) -> Value {
    arguments[key] = value;
    arguments
}

fn without(mut arguments: Value, key: &str) -> Value {
    arguments.as_object_mut().unwrap().remove(key);
    arguments
}

#[tokio::test]
async fn every_policy_tool_refuses_a_run_scoped_caller_on_a_foreign_type() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    add_foreign_type(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    for (id, tool) in (1..).zip(POLICY_TOOLS) {
        let refused = run
            .structured(id, tool, well_formed(tool, FOREIGN_TYPE))
            .await;
        assert_eq!(refused["ok"], false, "{tool}: {refused:#}");
        assert_eq!(refused["code"], "foreign_scope", "{tool}: {refused:#}");
        assert_eq!(
            refused["detail"], "The caller is not authorized for that workflow.",
            "{tool}: {refused:#}"
        );
    }
    for (id, tool) in (20..).zip(POLICY_TOOLS) {
        let missing = run
            .structured(
                id,
                tool,
                well_formed(tool, "70000000-0000-0000-0000-000000000000"),
            )
            .await;
        assert_eq!(missing["code"], "not_found", "{tool}: {missing:#}");
    }

    runtime.shutdown().await;
}

/// Every case must be a structured field rejection naming `field`, never a
/// JSON-RPC error and never a write.
async fn assert_field_rejections(
    client: &mut SocketClient,
    cases: impl IntoIterator<Item = (&str, Value, &str)>,
) {
    for (id, (tool, arguments, field)) in (100..).zip(cases) {
        let response = client.call(id, tool, arguments.clone()).await;
        assert!(
            response.get("error").is_none(),
            "{tool} {arguments}: never a JSON-RPC error: {response:#}"
        );
        let rejection = &response["result"]["structuredContent"];
        assert_eq!(rejection["ok"], false, "{tool} {arguments}: {response:#}");
        assert_eq!(
            rejection["code"], "validation",
            "{tool} {arguments}: {response:#}"
        );
        assert_eq!(
            rejection["field"], field,
            "{tool} {arguments}: {response:#}"
        );
    }
}

#[tokio::test]
async fn malformed_policy_arguments_name_the_offending_field() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let mut cases = Vec::new();
    for tool in POLICY_TOOLS {
        let arguments = well_formed(tool, OWN_TYPE);
        cases.push((tool, without(arguments.clone(), "type_id"), "type_id"));
        cases.push((
            tool,
            with(arguments.clone(), "type_id", json!(4)),
            "type_id",
        ));
        cases.push((
            tool,
            without(arguments.clone(), "workflow_revision"),
            "workflow_revision",
        ));
        // The i32 range check stays a field rejection.
        cases.push((
            tool,
            with(
                arguments.clone(),
                "workflow_revision",
                json!(2_147_483_648_i64),
            ),
            "workflow_revision",
        ));
        cases.push((
            tool,
            with(arguments, "workflow_revision", json!("0")),
            "workflow_revision",
        ));
    }
    let transition = well_formed("add_issue_type_workflow_transition", OWN_TYPE);
    let permission = well_formed("set_issue_type_workflow_transition_permission", OWN_TYPE);
    let auto_start = well_formed("set_issue_type_workflow_auto_start", OWN_TYPE);
    let start_state = well_formed("set_issue_type_workflow_start_state", OWN_TYPE);
    let binding = well_formed("upsert_issue_type_workflow_launch_binding", OWN_TYPE);
    cases.extend([
        (
            "add_issue_type_workflow_transition",
            without(transition.clone(), "from_state_id"),
            "from_state_id",
        ),
        (
            "add_issue_type_workflow_transition",
            without(transition.clone(), "to_state_id"),
            "to_state_id",
        ),
        (
            "add_issue_type_workflow_transition",
            with(transition.clone(), "agent_allowed", json!(null)),
            "agent_allowed",
        ),
        (
            "add_issue_type_workflow_transition",
            with(transition.clone(), "agent_allowed", json!("yes")),
            "agent_allowed",
        ),
        (
            "add_issue_type_workflow_transition",
            with(transition, "handoff", json!(1)),
            "handoff",
        ),
        (
            "set_issue_type_workflow_transition_permission",
            with(permission.clone(), "agent_allowed", json!(null)),
            "agent_allowed",
        ),
        (
            "set_issue_type_workflow_transition_permission",
            with(permission, "handoff", json!("no")),
            "handoff",
        ),
        (
            "set_issue_type_workflow_auto_start",
            without(auto_start.clone(), "auto_start"),
            "auto_start",
        ),
        (
            "set_issue_type_workflow_auto_start",
            with(auto_start, "auto_start", json!(null)),
            "auto_start",
        ),
        (
            "set_issue_type_workflow_start_state",
            without(start_state, "state_id"),
            "state_id",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "prompt", json!(3)),
            "prompt",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "profile", json!([])),
            "profile",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "model", json!(false)),
            "model",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "reasoning", json!({})),
            "reasoning",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "required_skills", json!("tdd")),
            "required_skills",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding.clone(), "stage_skills", json!(["tdd", 3])),
            "stage_skills",
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            with(binding, "agent", json!(7)),
            "agent",
        ),
    ]);
    assert_field_rejections(&mut global, cases).await;

    runtime.shutdown().await;
}
