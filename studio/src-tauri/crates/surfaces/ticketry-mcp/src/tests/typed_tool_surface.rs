//! The typed tool path, observed over the socket exactly as an agent sees it.

use serde_json::json;

use super::super::allowed_provider_operations;
use super::super::test_support::{SocketClient, PROJECT};
use super::{own, prepare_projects, start, OTHER_PROJECT};

#[tokio::test]
async fn malformed_task_detail_arguments_are_structured_field_rejections() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    for (id, arguments) in [(1, json!({})), (2, json!({"id_or_key": 7}))] {
        let response = global.call(id, "get_task_details", arguments).await;
        assert!(
            response.get("error").is_none(),
            "never a JSON-RPC error: {response:#}"
        );
        let rejection = &response["result"]["structuredContent"];
        assert_eq!(rejection["ok"], false, "{response:#}");
        assert_eq!(rejection["code"], "validation", "{response:#}");
        assert_eq!(rejection["field"], "id_or_key", "{response:#}");
        assert!(rejection["detail"]
            .as_str()
            .is_some_and(|detail| !detail.is_empty()));
    }

    let ignored = global
        .structured(
            3,
            "get_task_details",
            json!({"id_or_key": "AUTH-1", "unexpected": true}),
        )
        .await;
    assert_eq!(
        ignored["result"]["name"], "Authorized caller",
        "{ignored:#}"
    );
    assert_eq!(ignored["result"]["project_id"], PROJECT, "{ignored:#}");

    runtime.shutdown().await;
}

#[tokio::test]
async fn typed_argument_refusals_use_the_approved_validation_code() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    for (id, tool, arguments, field) in [
        (
            1,
            "list_tasks",
            json!({"project_id": PROJECT, "include_description": "yes"}),
            "include_description",
        ),
        (
            2,
            "update_task",
            json!({"id_or_key": "30000000-0000-0000-0000-000000000000", "name": 1}),
            "name",
        ),
        (
            3,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": "40000000-0000-0000-0000-000000000000",
                "state_id": "60000000-0000-0000-0000-000000000000",
                "workflow_revision": 0, "prompt": 3
            }),
            "prompt",
        ),
    ] {
        let response = global.call(id, tool, arguments).await;
        assert!(response.get("error").is_none(), "{tool}: {response:#}");
        let rejection = &response["result"]["structuredContent"];
        assert_eq!(rejection["ok"], false, "{tool}: {response:#}");
        assert_eq!(rejection["code"], "validation", "{tool}: {response:#}");
        assert_eq!(rejection["field"], field, "{tool}: {response:#}");
        assert!(
            rejection["detail"]
                .as_str()
                .is_some_and(|detail| !detail.is_empty()),
            "{tool}: {response:#}"
        );
    }

    // A domain refusal of well-formed arguments keeps its own code.
    let unknown_type = global
        .structured(
            4,
            "create_task",
            json!({"project_id": PROJECT, "name": "New", "issue_type": "Nonexistent"}),
        )
        .await;
    assert_eq!(unknown_type["ok"], false, "{unknown_type:#}");
    assert_eq!(unknown_type["code"], "field_validation", "{unknown_type:#}");
    assert_eq!(unknown_type["field"], "issue_type", "{unknown_type:#}");

    runtime.shutdown().await;
}

#[tokio::test]
async fn every_tool_kind_shares_authorization_and_scope() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    runtime
        .grant_for_test("run-valid", "listing", ["list_projects".to_owned()], false)
        .await
        .unwrap();
    let socket = runtime.socket_path();

    let mut global = SocketClient::connect_global(socket).await;
    let ping = global
        .structured(1, "mcp_ping", json!({"ignored": 1}))
        .await;
    assert_eq!(ping, json!({"status": "ok", "server": "ticketry"}));
    let details = global
        .structured(2, "get_task_details", json!({"id_or_key": "AUTH-1"}))
        .await;
    assert_eq!(
        details["result"]["name"], "Authorized caller",
        "{details:#}"
    );
    let terminate = global
        .structured(3, "terminate_current_run", json!({}))
        .await;
    assert_eq!(
        terminate["reason"], "authorization_missing",
        "{terminate:#}"
    );

    let mut run = SocketClient::connect_run(socket, "run-valid", "Bearer valid").await;
    let own_task = run
        .structured(4, "get_task_details", json!({"id_or_key": "AUTH-1"}))
        .await;
    assert_eq!(
        own_task["result"]["name"], "Authorized caller",
        "{own_task:#}"
    );
    let missing = run
        .structured(5, "get_task_details", json!({"id_or_key": "AUTH-404"}))
        .await;
    assert_eq!(missing["ok"], false, "{missing:#}");
    assert_eq!(missing["code"], "not_found", "{missing:#}");

    let mut listing = SocketClient::connect_run(socket, "run-valid", "Bearer listing").await;
    let listed = listing
        .request(json!({"jsonrpc":"2.0","id":6,"method":"tools/list","params":{}}))
        .await;
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["list_projects"], "{listed:#}");
    for (id, tool, arguments) in [
        (7, "mcp_ping", json!({})),
        (8, "get_task_details", json!({"id_or_key": "AUTH-1"})),
        (9, "list_tasks", json!({"project_id": PROJECT})),
    ] {
        let refused = listing.structured(id, tool, arguments).await;
        assert_eq!(
            refused["reason"], "authorization_tool_disallowed",
            "{tool}: {refused:#}"
        );
    }

    let unknown = global.call(10, "no_such_tool", json!({})).await;
    assert_eq!(unknown["error"]["code"], -32602, "{unknown:#}");

    runtime.shutdown().await;
}

#[tokio::test]
async fn only_the_ping_answers_before_runtime_reconciliation_finishes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    ticketry_settings::publish_readiness(
        directory.path(),
        &ticketry_settings::Slice2Readiness::unavailable(),
    )
    .expect("close readiness");
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    assert_eq!(
        global.structured(1, "mcp_ping", json!({})).await["status"],
        "ok"
    );
    for (id, tool, arguments) in [
        (2, "get_task_details", json!({"id_or_key": "AUTH-1"})),
        (3, "get_task_details", json!({})),
        (4, "list_projects", json!({})),
    ] {
        let gated = global.structured(id, tool, arguments).await;
        assert_eq!(gated["code"], "service_unavailable", "{tool}: {gated:#}");
        assert_eq!(gated["phase"], "runtime-reconciliation");
    }

    runtime.shutdown().await;
}

#[tokio::test]
async fn wrong_typed_read_arguments_are_structured_field_rejections() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    for (id, tool, arguments, field) in [
        (1, "list_modules", json!({}), "project_id"),
        (
            2,
            "list_issue_types",
            json!({"project_id": 1}),
            "project_id",
        ),
        (
            3,
            "list_tasks",
            json!({"project_id": PROJECT, "include_description": "yes"}),
            "include_description",
        ),
        (
            4,
            "list_tasks",
            json!({"project_id": PROJECT, "state_name": 3}),
            "state_name",
        ),
        (
            5,
            "list_tasks",
            json!({"project_id": PROJECT, "module_id": false}),
            "module_id",
        ),
        (6, "get_task_scope_context", json!({}), "id_or_key"),
        (
            7,
            "get_dependency_graph",
            json!({"root_task_id": []}),
            "root_task_id",
        ),
        (8, "get_issue_type_workflow_settings", json!({}), "type_id"),
    ] {
        let response = global.call(id, tool, arguments).await;
        assert!(response.get("error").is_none(), "{tool}: {response:#}");
        let rejection = &response["result"]["structuredContent"];
        assert_eq!(rejection["ok"], false, "{tool}: {response:#}");
        assert_eq!(rejection["code"], "validation", "{tool}: {response:#}");
        assert_eq!(rejection["field"], field, "{tool}: {response:#}");
    }

    runtime.shutdown().await;
}

#[tokio::test]
async fn well_formed_read_arguments_keep_their_results() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let unknown_state = global
        .structured(
            1,
            "list_tasks",
            json!({"project_id": PROJECT, "state_name": "No such state"}),
        )
        .await;
    assert_eq!(unknown_state, json!({"result": []}));
    let nulls = global
        .structured(
            2,
            "list_tasks",
            json!({"project_id": PROJECT, "module_id": null, "state_name": null}),
        )
        .await;
    let rows = nulls["result"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "{nulls:#}");
    assert_eq!(rows[0]["name"], "Authorized caller");
    assert_eq!(rows[0]["description"], json!(null), "{nulls:#}");
    let described = global
        .structured(
            3,
            "list_tasks",
            json!({"project_id": PROJECT, "include_description": true}),
        )
        .await;
    assert_eq!(described["result"][0]["description"], "", "{described:#}");

    let graph = global
        .structured(4, "get_dependency_graph", json!({"root_task_id": "AUTH-1"}))
        .await;
    assert_eq!(
        graph["root_id"], "30000000-0000-0000-0000-000000000000",
        "{graph:#}"
    );
    assert!(graph.get("result").is_none(), "{graph:#}");

    runtime.shutdown().await;
}

#[tokio::test]
async fn run_scoped_reads_refuse_foreign_scope_and_answer_their_own() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    for (id, tool) in [(1, "list_issue_types"), (2, "list_tasks")] {
        let refused = run
            .structured(id, tool, json!({"project_id": OTHER_PROJECT}))
            .await;
        assert_eq!(refused["code"], "foreign_scope", "{tool}: {refused:#}");
    }
    let foreign_module = run
        .structured(
            3,
            "list_tasks",
            json!({"project_id": PROJECT, "module_id": "50000000000000000000000000000000"}),
        )
        .await;
    assert_eq!(foreign_module["ok"], false, "{foreign_module:#}");

    let types = run
        .structured(4, "list_issue_types", json!({"project_id": PROJECT}))
        .await;
    assert_eq!(types["result"][0]["name"], "Story", "{types:#}");
    let context = run
        .structured(5, "get_task_scope_context", json!({"id_or_key": "AUTH-1"}))
        .await;
    assert!(context["result"].is_object(), "{context:#}");
    let graph = run
        .structured(6, "get_dependency_graph", json!({"root_task_id": "AUTH-1"}))
        .await;
    assert_eq!(
        graph["root_id"], "30000000-0000-0000-0000-000000000000",
        "{graph:#}"
    );

    runtime.shutdown().await;
}
