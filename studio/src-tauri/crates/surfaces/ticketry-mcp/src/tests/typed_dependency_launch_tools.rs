//! Dependency, attachment and launch tools on the typed path: scope,
//! malformed, default and null arguments, observed over the socket exactly as
//! an agent sees them. Well-formed writes and launches against the full
//! command database live in the root package's `mcp_acceptance` and
//! `mcp_kill_failure` binaries.

use std::path::Path;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};

use super::super::allowed_provider_operations;
use super::super::test_support::{SocketClient, PROJECT};
use super::{own, prepare_projects, start, OTHER_PROJECT};

const TASK: &str = "30000000-0000-0000-0000-000000000000";
const FOREIGN_TASK: &str = "80000000-0000-0000-0000-000000000000";

async fn add_foreign_task(directory: &Path) {
    let database = Database::connect(format!("sqlite:{}", directory.join("state.db").display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, parent_id,
                 module_id, state_id, state_revision, name, sequence_id, is_archived, rank,
                 description, workspace_tab_order, created_at, updated_at)
             VALUES ('80000000000000000000000000000000', '20000000000000000000000000000000',
                 'task', '40000000000000000000000000000000', NULL, NULL, NULL, 0,
                 'Foreign item', 1, 0, 'A', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}

/// A run-scoped connection for `run-valid`, whose project is `PROJECT`.
async fn run_connection(socket: &Path, runtime: &super::super::McpRuntime) -> SocketClient {
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    SocketClient::connect_run(socket, "run-valid", "Bearer valid").await
}

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

#[tokio::test]
async fn non_string_ids_and_non_bool_reset_are_field_rejections() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    assert_field_rejections(
        &mut global,
        [
            (
                "set_task_blockers",
                json!({"task_id": TASK, "blocked_by_ids": [7]}),
                "blocked_by_ids",
            ),
            (
                "set_task_blockers",
                json!({"task_id": TASK, "blocked_by_ids": "AUTH-1"}),
                "blocked_by_ids",
            ),
            (
                "set_task_blockers",
                json!({"task_id": TASK}),
                "blocked_by_ids",
            ),
            (
                "reparent_tasks",
                json!({"project_id": PROJECT, "parent_task_id": TASK, "task_ids": [null]}),
                "task_ids",
            ),
            (
                "execute_dependency_graph",
                json!({"root_task_id": TASK, "reset": "yes"}),
                "reset",
            ),
            (
                "execute_dependency_graph",
                json!({"root_task_id": TASK, "reset": 1}),
                "reset",
            ),
        ],
    )
    .await;

    runtime.shutdown().await;
}

#[tokio::test]
async fn every_referenced_id_is_scope_checked_for_a_run_caller() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    add_foreign_task(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut run = run_connection(runtime.socket_path(), &runtime).await;

    let foreign_file = directory.path().join("evidence.txt");
    std::fs::write(&foreign_file, "evidence").unwrap();
    let file_path = foreign_file.display().to_string();
    let cases = [
        // Blockers and dependents: the target and every referenced id.
        (
            "set_task_blockers",
            json!({"task_id": FOREIGN_TASK, "blocked_by_ids": []}),
        ),
        (
            "set_task_blockers",
            json!({"task_id": TASK, "blocked_by_ids": [FOREIGN_TASK]}),
        ),
        (
            "add_task_blocker",
            json!({"task_id": FOREIGN_TASK, "blocker_task_id": TASK}),
        ),
        (
            "add_task_blocker",
            json!({"task_id": TASK, "blocker_task_id": FOREIGN_TASK}),
        ),
        (
            "add_task_dependent",
            json!({"task_id": FOREIGN_TASK, "dependent_task_id": TASK}),
        ),
        (
            "add_task_dependent",
            json!({"task_id": TASK, "dependent_task_id": FOREIGN_TASK}),
        ),
        // Reparent: project, then parent.
        (
            "reparent_tasks",
            json!({"project_id": OTHER_PROJECT, "parent_task_id": TASK, "task_ids": []}),
        ),
        (
            "reparent_tasks",
            json!({"project_id": PROJECT, "parent_task_id": FOREIGN_TASK, "task_ids": []}),
        ),
        // Attach: project, then task.
        (
            "attach_file",
            json!({"project_id": OTHER_PROJECT, "task_id": TASK, "file_path": file_path}),
        ),
        (
            "attach_file",
            json!({"project_id": PROJECT, "task_id": FOREIGN_TASK, "file_path": file_path}),
        ),
        (
            "execute_dependency_graph",
            json!({"root_task_id": FOREIGN_TASK}),
        ),
        (
            "launch_default_coding_agent",
            json!({"id_or_key": FOREIGN_TASK}),
        ),
    ];
    for (id, (tool, arguments)) in (1..).zip(cases) {
        let refused = run.structured(id, tool, arguments.clone()).await;
        assert_eq!(refused["ok"], false, "{tool} {arguments}: {refused:#}");
        assert_eq!(
            refused["code"], "foreign_scope",
            "{tool} {arguments}: {refused:#}"
        );
    }

    // Reparent also checks each listed item's project on its own.
    let reparent = run
        .structured(
            50,
            "reparent_tasks",
            json!({"project_id": PROJECT, "parent_task_id": TASK, "task_ids": [FOREIGN_TASK]}),
        )
        .await;
    assert_eq!(
        reparent["skipped"],
        json!([{"task_id": FOREIGN_TASK, "reason": "cross_project"}]),
        "{reparent:#}"
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn refusals_and_unavailable_services_keep_their_output_shapes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    // No terminal launch or graph run services are wired here.
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let missing_file = global
        .structured(
            1,
            "attach_file",
            json!({"project_id": PROJECT, "task_id": TASK,
                   "file_path": directory.path().join("absent.txt")}),
        )
        .await;
    assert_eq!(
        missing_file,
        json!({"success": false, "message": "File not found", "data": null})
    );

    let graph = global
        .structured(
            2,
            "execute_dependency_graph",
            json!({"root_task_id": "AUTH-1", "agent": "  "}),
        )
        .await;
    assert_eq!(
        graph,
        json!({"root_id": TASK,
               "error": "execution_reconciliation_unavailable"})
    );

    let run_now = global
        .structured(3, "run_now", json!({"id_or_key": "AUTH-1"}))
        .await;
    assert_eq!(run_now["code"], "run_now_unavailable", "{run_now:#}");
    assert_eq!(run_now["target_id"], "AUTH-1", "{run_now:#}");
    assert_eq!(run_now["committed_state"], Value::Null, "{run_now:#}");
    assert_eq!(run_now["committed_issue_type"], Value::Null, "{run_now:#}");

    let launch = global
        .structured(
            4,
            "launch_default_coding_agent",
            json!({"id_or_key": "AUTH-1"}),
        )
        .await;
    let mut keys: Vec<&String> = launch.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, ["error", "target_id"], "{launch:#}");
    assert_eq!(launch["target_id"], TASK);

    runtime.shutdown().await;
}

/// `module_id` is published and accepted but has never changed where items
/// land; supplying one leaves the outcome identical. Giving it meaning is a
/// separate decision.
#[tokio::test]
async fn reparent_accepts_and_ignores_module_id() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let request = json!({
        "project_id": PROJECT, "parent_task_id": TASK, "task_ids": ["AUTH-404", TASK],
    });
    let expected = json!({
        "parent_task_id": TASK,
        "reparented": [],
        "skipped": [
            {"task_id": "AUTH-404", "reason": "not_found"},
            {"task_id": TASK, "reason": "self_parent"},
        ],
        "failed": [],
    });
    for (id, module_id) in (1..).zip([None, Some(Value::Null), Some(json!("MOD-9"))]) {
        let mut arguments = request.clone();
        if let Some(module_id) = module_id {
            arguments["module_id"] = module_id;
        }
        let response = global.structured(id, "reparent_tasks", arguments).await;
        assert_eq!(response, expected, "{response:#}");
    }

    runtime.shutdown().await;
}
