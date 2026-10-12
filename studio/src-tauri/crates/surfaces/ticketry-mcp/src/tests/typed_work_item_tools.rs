//! Work-item create/update tools on the typed path: malformed, default and
//! null arguments, observed over the socket exactly as an agent sees them.
//! Well-formed writes against the full command database live in the root
//! package's `mcp_acceptance` binary.

use serde_json::{json, Value};

use super::super::test_support::{SocketClient, PROJECT};
use super::{own, prepare_projects, start};

const TASK: &str = "30000000-0000-0000-0000-000000000000";

/// Every case must be a structured field rejection naming `field`, never a
/// JSON-RPC error and never a write.
async fn assert_field_rejections(
    client: &mut SocketClient,
    cases: impl IntoIterator<Item = (&str, Value, &str)>,
) {
    for (id, (tool, arguments, field)) in (1..).zip(cases) {
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

fn finding(overrides: Value) -> Value {
    let mut arguments = json!({
        "project_id": PROJECT, "parent_id": TASK, "name": "Finding",
        "path": "src/lib.rs", "line_start": 3, "line_end": 4,
    });
    for (key, value) in overrides.as_object().unwrap() {
        if value == &json!("<omit>") {
            arguments.as_object_mut().unwrap().remove(key);
        } else {
            arguments[key] = value.clone();
        }
    }
    arguments
}

#[tokio::test]
async fn review_finding_line_numbers_must_be_present_positive_integers() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let tool = "create_review_finding";
    assert_field_rejections(
        &mut global,
        [
            (tool, finding(json!({"line_start": "<omit>"})), "line_start"),
            (tool, finding(json!({"line_end": "<omit>"})), "line_end"),
            (tool, finding(json!({"line_start": "3"})), "line_start"),
            (tool, finding(json!({"line_end": 4.5})), "line_end"),
            (tool, finding(json!({"line_start": null})), "line_start"),
            (tool, finding(json!({"line_start": 0})), "line_start"),
            (tool, finding(json!({"line_end": 0})), "line_end"),
            (tool, finding(json!({"line_end": -2})), "line_end"),
        ],
    )
    .await;

    runtime.shutdown().await;
}

#[tokio::test]
async fn malformed_create_arguments_name_the_offending_field() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let task = |overrides: Value| {
        let mut arguments = json!({"project_id": PROJECT, "name": "New", "issue_type": "Story"});
        arguments
            .as_object_mut()
            .unwrap()
            .extend(overrides.as_object().unwrap().clone());
        arguments
    };
    let sub_task = |overrides: Value| {
        let mut arguments = task(json!({"parent_id": TASK}));
        arguments
            .as_object_mut()
            .unwrap()
            .extend(overrides.as_object().unwrap().clone());
        arguments
    };
    assert_field_rejections(
        &mut global,
        [
            (
                "create_task",
                json!({"name": "New", "issue_type": "Story"}),
                "project_id",
            ),
            (
                "create_task",
                json!({"project_id": PROJECT, "issue_type": "Story"}),
                "name",
            ),
            (
                "create_task",
                json!({"project_id": PROJECT, "name": "New"}),
                "issue_type",
            ),
            ("create_task", task(json!({"name": null})), "name"),
            ("create_task", task(json!({"issue_type": 3})), "issue_type"),
            (
                "create_task",
                task(json!({"description": null})),
                "description",
            ),
            (
                "create_task",
                task(json!({"description": 5})),
                "description",
            ),
            (
                "create_task",
                task(json!({"module_id": false})),
                "module_id",
            ),
            ("create_task", task(json!({"state_name": 3})), "state_name"),
            (
                "create_sub_task",
                json!({"project_id": PROJECT, "name": "New", "issue_type": "Story"}),
                "parent_id",
            ),
            (
                "create_sub_task",
                sub_task(json!({"parent_id": 9})),
                "parent_id",
            ),
            (
                "create_sub_task",
                sub_task(json!({"description": null})),
                "description",
            ),
            (
                "create_sub_task",
                sub_task(json!({"state_name": []})),
                "state_name",
            ),
        ],
    )
    .await;

    runtime.shutdown().await;
}

#[tokio::test]
async fn malformed_update_arguments_name_the_offending_field() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let status = json!({"project_id": PROJECT, "task_id": TASK, "status_name": "Done"});
    let append = json!({"project_id": PROJECT, "task_id": TASK, "new_content": "More"});
    let without = |arguments: &Value, key: &str| {
        let mut arguments = arguments.clone();
        arguments.as_object_mut().unwrap().remove(key);
        arguments
    };
    let with = |arguments: &Value, key: &str, value: Value| {
        let mut arguments = arguments.clone();
        arguments[key] = value;
        arguments
    };
    assert_field_rejections(
        &mut global,
        [
            ("update_task", json!({"name": "Renamed"}), "id_or_key"),
            ("update_task", json!({"id_or_key": TASK, "name": 1}), "name"),
            (
                "update_task",
                json!({"id_or_key": TASK, "description": []}),
                "description",
            ),
            (
                "append_task_description",
                without(&append, "project_id"),
                "project_id",
            ),
            (
                "append_task_description",
                without(&append, "task_id"),
                "task_id",
            ),
            (
                "append_task_description",
                without(&append, "new_content"),
                "new_content",
            ),
            (
                "append_task_description",
                with(&append, "new_content", json!(null)),
                "new_content",
            ),
            (
                "update_task_status",
                without(&status, "project_id"),
                "project_id",
            ),
            (
                "update_task_status",
                with(&status, "task_id", json!(4)),
                "task_id",
            ),
            (
                "update_task_status",
                without(&status, "status_name"),
                "status_name",
            ),
            (
                "update_task_status",
                with(&status, "status_name", json!(null)),
                "status_name",
            ),
        ],
    )
    .await;

    runtime.shutdown().await;
}

#[tokio::test]
async fn malformed_tags_keep_their_field_specific_messages() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    assert_field_rejections(
        &mut global,
        [("add_task_tags", json!({"tags": ["backend"]}), "id_or_key")],
    )
    .await;
    for (id, tags, detail) in [
        (10, json!(null), "tags must be an array."),
        (11, json!("backend"), "tags must be an array."),
        (12, json!(["backend", 7]), "tags values must be strings."),
        (13, json!([null]), "tags values must be strings."),
    ] {
        let rejected = global
            .structured(
                id,
                "add_task_tags",
                json!({"id_or_key": TASK, "tags": tags}),
            )
            .await;
        assert_eq!(rejected["ok"], false, "{tags}: {rejected:#}");
        assert_eq!(rejected["code"], "validation", "{tags}: {rejected:#}");
        assert_eq!(rejected["field"], "tags", "{tags}: {rejected:#}");
        assert_eq!(rejected["detail"], detail, "{tags}: {rejected:#}");
    }
    let missing = global
        .structured(14, "add_task_tags", json!({"id_or_key": TASK}))
        .await;
    assert_eq!(missing["code"], "validation", "{missing:#}");
    assert_eq!(missing["field"], "tags", "{missing:#}");

    runtime.shutdown().await;
}
