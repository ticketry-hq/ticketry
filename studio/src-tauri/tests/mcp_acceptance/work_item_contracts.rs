//! Default and null arguments on the work-item create/update tools write the
//! same rows a fully spelled-out call writes, against the full command
//! database. Malformed arguments are covered by the `ticketry-mcp` crate.

use std::sync::Arc;

use serde_json::{json, Value};

use super::{prepare_command_database, MissingTerminalRuntime, MODULE};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{
    allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient, PROJECT,
};

async fn run_client(directory: &tempfile::TempDir) -> (McpRuntime, SocketClient) {
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    (runtime, client)
}

async fn created(client: &mut SocketClient, id: u64, tool: &str, arguments: Value) -> String {
    let output = client.structured(id, tool, arguments).await;
    output["result"]
        .as_str()
        .unwrap_or_else(|| panic!("{tool} failed: {output:#}"))
        .to_owned()
}

/// The stored row as `get_task_details` reports it, without its identity.
async fn row(client: &mut SocketClient, id: u64, task: &str) -> Value {
    let mut details = client
        .structured(id, "get_task_details", json!({"id_or_key": task}))
        .await["result"]
        .clone();
    let fields = details
        .as_object_mut()
        .unwrap_or_else(|| panic!("no details for {task}"));
    for identity in ["id", "key", "sequence_id"] {
        fields.remove(identity);
    }
    details
}

#[tokio::test]
async fn omitted_and_null_create_arguments_write_the_spelled_out_rows() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;

    let spelled_out = created(
        &mut client,
        1,
        "create_task",
        json!({
            "project_id": PROJECT, "name": "Story", "issue_type": "Story",
            "description": "", "module_id": MODULE, "state_name": "Backlog"
        }),
    )
    .await;
    let defaulted = created(
        &mut client,
        2,
        "create_task",
        json!({
            "project_id": PROJECT, "name": "Story", "issue_type": "Story",
            "module_id": MODULE, "state_name": null
        }),
    )
    .await;
    let expected = row(&mut client, 3, &spelled_out).await;
    assert_eq!(expected["description"], "", "{expected:#}");
    assert_eq!(row(&mut client, 4, &defaulted).await, expected);

    let unplaced = created(
        &mut client,
        5,
        "create_task",
        json!({
            "project_id": PROJECT, "name": "Loose", "issue_type": "Story",
            "module_id": null
        }),
    )
    .await;
    assert_eq!(
        row(&mut client, 6, &unplaced).await["parent_id"],
        Value::Null
    );

    let spelled_child = created(
        &mut client,
        7,
        "create_sub_task",
        json!({
            "project_id": PROJECT, "parent_id": spelled_out, "name": "Child",
            "issue_type": "Implementation", "description": "", "state_name": "Backlog"
        }),
    )
    .await;
    let defaulted_child = created(
        &mut client,
        8,
        "create_sub_task",
        json!({
            "project_id": PROJECT, "parent_id": spelled_out, "name": "Child",
            "issue_type": "Implementation", "state_name": null
        }),
    )
    .await;
    let expected_child = row(&mut client, 9, &spelled_child).await;
    assert_eq!(expected_child["description"], "", "{expected_child:#}");
    assert_eq!(
        expected_child["parent_id"], spelled_out,
        "{expected_child:#}"
    );
    assert_eq!(row(&mut client, 10, &defaulted_child).await, expected_child);

    runtime.shutdown().await;
}

#[tokio::test]
async fn null_update_fields_mean_omitted_and_never_clear() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;
    let task = created(
        &mut client,
        1,
        "create_task",
        json!({
            "project_id": PROJECT, "module_id": MODULE, "name": "Kept",
            "issue_type": "Story", "description": "Kept description"
        }),
    )
    .await;

    let renamed = client
        .structured(
            2,
            "update_task",
            json!({"id_or_key": task, "name": "Renamed", "description": null}),
        )
        .await;
    assert_eq!(renamed["ok"], true, "{renamed:#}");
    assert_eq!(renamed["task_id"], task, "{renamed:#}");
    assert_eq!(renamed["updated_fields"], json!(["name"]), "{renamed:#}");
    let described = client
        .structured(
            3,
            "update_task",
            json!({"id_or_key": task, "name": null, "description": "New description"}),
        )
        .await;
    assert_eq!(
        described["updated_fields"],
        json!(["description"]),
        "{described:#}"
    );
    let after = row(&mut client, 4, &task).await;
    assert_eq!(after["name"], "Renamed", "{after:#}");
    assert_eq!(after["description"], "New description", "{after:#}");

    let nothing = client
        .structured(
            5,
            "update_task",
            json!({"id_or_key": task, "name": null, "description": null}),
        )
        .await;
    let omitted = client
        .structured(6, "update_task", json!({"id_or_key": task}))
        .await;
    assert_eq!(nothing["ok"], false, "{nothing:#}");
    assert_eq!(nothing, omitted, "null must answer exactly as omitted");
    assert_eq!(row(&mut client, 7, &task).await, after);

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_refused_status_move_keeps_the_gate_reason() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;
    let task = created(
        &mut client,
        1,
        "create_task",
        json!({"project_id": PROJECT, "module_id": MODULE, "name": "Gated", "issue_type": "Story"}),
    )
    .await;

    let refused = client
        .structured(
            2,
            "update_task_status",
            json!({"project_id": PROJECT, "task_id": task, "status_name": "Validation"}),
        )
        .await;
    assert_eq!(refused["ok"], false, "{refused:#}");
    assert_eq!(refused["task_id"], task, "{refused:#}");
    for key in ["detail", "code", "from", "to"] {
        assert!(
            refused[key].as_str().is_some_and(|value| !value.is_empty()),
            "missing {key}: {refused:#}"
        );
    }
    let unknown = client
        .structured(
            3,
            "update_task_status",
            json!({"project_id": PROJECT, "task_id": task, "status_name": "Nowhere"}),
        )
        .await;
    assert_eq!(
        unknown,
        json!({"ok": false, "task_id": task, "error": "Unknown workflow state \"Nowhere\"."})
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn each_tool_answers_in_its_declared_shape() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;
    let task = created(
        &mut client,
        1,
        "create_task",
        json!({"project_id": PROJECT, "module_id": MODULE, "name": "Shaped", "issue_type": "Story"}),
    )
    .await;

    let appended = client
        .structured(
            2,
            "append_task_description",
            json!({"project_id": PROJECT, "task_id": task, "new_content": "More."}),
        )
        .await;
    assert_eq!(appended, json!({"result": true}));
    let projects = client.structured(3, "list_projects", json!({})).await;
    assert_eq!(projects["result"][0]["id"], PROJECT, "{projects:#}");
    let renamed = client
        .structured(
            4,
            "update_task",
            json!({"id_or_key": task, "name": "Reshaped"}),
        )
        .await;
    assert!(renamed.get("result").is_none(), "{renamed:#}");
    assert_eq!(renamed["ok"], true, "{renamed:#}");
    let refused = client
        .structured(5, "list_modules", json!({"project_id": "nowhere"}))
        .await;
    assert!(refused.get("result").is_none(), "{refused:#}");
    assert_eq!(refused["ok"], false, "{refused:#}");

    runtime.shutdown().await;
}
