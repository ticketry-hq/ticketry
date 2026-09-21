//! Drives the in-process MCP listener against the assembled WorkTracker
//! GraphQL schema. It lives in the root package rather than in `ticketry-mcp`
//! because the schema is composed out of that crate, not underneath it.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use tauri_graphql::{TransportApi, TransportApiImpl};
use tokio::time::{timeout, Duration};

#[path = "mcp_acceptance/codex_rename.rs"]
mod codex_rename;
mod common;
#[path = "mcp_acceptance/tags.rs"]
mod tags;
#[path = "mcp_acceptance/termination.rs"]
mod termination;

use ticketry_data_directory::DataDirectoryGuard;
use ticketry_entities::session;
use ticketry_graphql_schema::initialize_with_worktracker_commands_and_install;
use ticketry_launch::{CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode};
use ticketry_mcp::{McpConfiguration, McpRuntime, SocketClient, PROJECT};
use ticketry_terminal::{
    CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime, TerminalLaunchRuntime,
    TerminalLaunchService,
};

const TASK_TYPE: &str = "30000000-0000-0000-0000-000000000001";
const IMPLEMENTATION_TYPE: &str = "30000000-0000-0000-0000-000000000002";
const BACKLOG: &str = "40000000-0000-0000-0000-000000000001";
const REVIEW: &str = "40000000-0000-0000-0000-000000000002";
const MODULE: &str = "20000000-0000-0000-0000-000000000001";

fn launch_binding_for<'a>(settings: &'a Value, state_id: &str) -> &'a Value {
    settings["launch_bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|binding| binding["state_id"] == state_id)
        .unwrap_or_else(|| panic!("missing launch binding for {state_id}: {settings:#}"))
}

struct MissingTerminalRuntime;

#[async_trait]
impl TerminalCleanupRuntime for MissingTerminalRuntime {
    async fn inspect(&self, _: &session::Model) -> CleanupRuntimeObservation {
        CleanupRuntimeObservation::Missing
    }

    async fn kill_verified(&self, _: &session::Model) -> CleanupKillResult {
        panic!("proved absence must not spend a kill")
    }
}

#[async_trait]
impl TerminalLaunchRuntime for MissingTerminalRuntime {
    async fn preflight(&self, _: &CreateTerminalSession) -> Result<(), TerminalLaunchError> {
        Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::UnusableFolder,
            "the module folder disappeared since the decision",
        ))
    }

    async fn observe(&self, _: &str) -> ticketry_terminal::TerminalRuntimeObservation {
        unreachable!("a rejected preparation never observes")
    }

    async fn materialize_and_create(
        &self,
        _: &ticketry_entities::launch_material::Model,
        _: &dyn ticketry_terminal::TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        unreachable!("a rejected preparation never materializes")
    }
}
use common::mcp_database::prepare_command_database;

/// Read the authoritative terminal facts the Rust termination service owns.
async fn terminal_record(directory: &tempfile::TempDir) -> (Option<String>, i64) {
    let database = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open terminal fact reader");
    let row = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT (SELECT ended_at FROM agent_runs WHERE id = 'run-valid') AS ended_at, \
             (SELECT COUNT(*) FROM runs_status_events WHERE agent_run_id = 'run-valid' \
              AND event_kind = 'agent_run.terminal') AS events"
                .to_owned(),
        ))
        .await
        .expect("read terminal facts")
        .expect("terminal fact row");
    let record = (
        row.try_get::<Option<String>>("", "ended_at").unwrap(),
        row.try_get::<i64>("", "events").unwrap(),
    );
    database.close().await.expect("close terminal fact reader");
    record
}

async fn wait_for_terminal_record(directory: &tempfile::TempDir) -> (Option<String>, i64) {
    timeout(Duration::from_secs(2), async {
        loop {
            let record = terminal_record(directory).await;
            if record.0.is_some() {
                return record;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background terminal cleanup did not settle")
}

#[tokio::test]
async fn mcp_stage_skills_use_the_workflow_list_contract() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    ticketry_work_management::launch_binding_stage_skills_migration::install(&database)
        .await
        .unwrap();
    database.close().await.unwrap();
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
        .grant_for_test(
            "run-valid",
            "valid",
            ticketry_mcp::allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    let saved = run
        .structured(
            1,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE,
                "state_id": BACKLOG,
                "workflow_revision": 0,
                "prompt": "Implement this item",
                "required_skills": ["tdd"],
                "stage_skills": [
                    "  future skill, one  ",
                    "",
                    "Future-Skill",
                    "future skill, one"
                ]
            }),
        )
        .await;

    assert_eq!(saved["workflow_revision"], 1, "{saved:#}");
    let backlog = launch_binding_for(&saved, BACKLOG);
    assert_eq!(
        backlog["stage_skills"],
        json!(["future skill, one", "Future-Skill"])
    );
    assert_eq!(backlog["required_skills"], json!(["tdd"]));

    let stale = run
        .structured(
            2,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE,
                "state_id": BACKLOG,
                "workflow_revision": 0,
                "stage_skills": ["must not persist"]
            }),
        )
        .await;
    assert_eq!(stale["code"], "stale_revision", "{stale:#}");

    let second_state = run
        .structured(
            3,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE,
                "state_id": REVIEW,
                "workflow_revision": 1,
                "prompt": "Review this item",
                "stage_skills": ["review-skill"]
            }),
        )
        .await;
    assert_eq!(second_state["workflow_revision"], 2, "{second_state:#}");
    assert_eq!(
        launch_binding_for(&second_state, BACKLOG)["stage_skills"],
        json!(["future skill, one", "Future-Skill"])
    );
    assert_eq!(
        launch_binding_for(&second_state, REVIEW)["stage_skills"],
        json!(["review-skill"])
    );

    let other_type = run
        .structured(
            4,
            "get_issue_type_workflow_settings",
            json!({"type_id": IMPLEMENTATION_TYPE}),
        )
        .await;
    assert!(other_type["launch_bindings"]
        .as_array()
        .unwrap()
        .iter()
        .all(|binding| binding["stage_skills"] == json!([])));

    let cleared = run
        .structured(
            5,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE,
                "state_id": BACKLOG,
                "workflow_revision": 2,
                "stage_skills": null
            }),
        )
        .await;
    assert_eq!(cleared["workflow_revision"], 3, "{cleared:#}");
    let cleared_backlog = launch_binding_for(&cleared, BACKLOG);
    assert_eq!(cleared_backlog["stage_skills"], json!([]));
    assert_eq!(cleared_backlog["required_skills"], json!(["tdd"]));
    assert_eq!(
        launch_binding_for(&cleared, REVIEW)["stage_skills"],
        json!(["review-skill"])
    );

    let no_op = run
        .structured(
            6,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE,
                "state_id": BACKLOG,
                "workflow_revision": 3,
                "stage_skills": []
            }),
        )
        .await;
    assert_eq!(no_op["workflow_revision"], 3, "{no_op:#}");

    drop(run);
    let mut reopened =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    let reopened = reopened
        .structured(
            7,
            "get_issue_type_workflow_settings",
            json!({"type_id": TASK_TYPE}),
        )
        .await;
    assert_eq!(reopened["workflow_revision"], 3, "{reopened:#}");
    assert_eq!(
        launch_binding_for(&reopened, BACKLOG)["stage_skills"],
        json!([])
    );
    assert_eq!(
        launch_binding_for(&reopened, REVIEW)["stage_skills"],
        json!(["review-skill"])
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn mcp_mutations_cover_crud_hierarchy_workflow_and_blockers_through_rust_commands() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let launch = TerminalLaunchService::new(
        Database::connect(format!(
            "sqlite:{}",
            directory.path().join("state.db").display()
        ))
        .await
        .unwrap(),
        Arc::new(MissingTerminalRuntime),
    );
    let runtime = McpRuntime::start_for_test_with_terminal_launch(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
        launch,
    )
    .await
    .unwrap();
    runtime
        .grant_for_test(
            "run-valid",
            "valid",
            ticketry_mcp::allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    let external_projects = global.call(0, "list_projects", json!({})).await;
    assert_eq!(
        external_projects["result"]["structuredContent"]["result"][0]["id"],
        PROJECT
    );

    let first_output = run
        .structured(
            1,
            "create_task",
            json!({
                "project_id": PROJECT, "module_id": MODULE, "name": "First", "issue_type": "Story"
            }),
        )
        .await;
    let first = first_output["result"]
        .as_str()
        .unwrap_or_else(|| panic!("create_task failed: {first_output:#}"))
        .to_owned();
    let second = run
        .structured(
            2,
            "create_task",
            json!({
                "project_id": PROJECT, "module_id": MODULE, "name": "Second", "issue_type": "Story"
            }),
        )
        .await["result"]
        .as_str()
        .unwrap()
        .to_owned();
    let parent = run
        .structured(
            3,
            "create_task",
            json!({
                "project_id": PROJECT, "module_id": MODULE, "name": "Parent", "issue_type": "Story"
            }),
        )
        .await["result"]
        .as_str()
        .unwrap()
        .to_owned();

    let updated = run
        .structured(
            4,
            "update_task",
            json!({
                "id_or_key": first, "name": "First updated"
            }),
        )
        .await;
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["updated_fields"], json!(["name"]));

    let blocked = run
        .structured(
            5,
            "set_task_blockers",
            json!({
                "task_id": second, "blocked_by_ids": [first]
            }),
        )
        .await;
    assert_eq!(blocked["blocked_by_ids"], json!([first]));

    let reparented = run
        .structured(
            6,
            "reparent_tasks",
            json!({
                "project_id": PROJECT, "parent_task_id": parent, "task_ids": [second]
            }),
        )
        .await;
    assert_eq!(reparented["reparented"][0]["task_id"], second);

    let workflow = run
        .structured(
            7,
            "add_issue_type_workflow_transition",
            json!({
                "type_id": TASK_TYPE, "from_state_id": BACKLOG, "to_state_id": REVIEW,
                "workflow_revision": 0
            }),
        )
        .await;
    assert_eq!(workflow["workflow_revision"], 1);
    let transitioned = run
        .structured(
            8,
            "update_task_status",
            json!({
                "project_id": PROJECT, "task_id": first, "status_name": "Review"
            }),
        )
        .await;
    assert_eq!(transitioned["ok"], true);
    assert_eq!(transitioned["status"], "Review");

    assert_eq!(
        run.structured(
            81,
            "append_task_description",
            json!({"project_id": PROJECT, "task_id": first, "new_content": "First note"}),
        )
        .await["result"],
        true
    );
    assert_eq!(
        run.structured(
            82,
            "append_task_description",
            json!({"project_id": PROJECT, "task_id": first, "new_content": "Second note"}),
        )
        .await["result"],
        true
    );
    let finding = run
        .structured(
            83,
            "create_review_finding",
            json!({
                "project_id": PROJECT, "parent_id": first, "name": "Thin adapter",
                "path": "studio/src-tauri/src/work_management/mcp/dispatch.rs",
                "line_start": 10, "line_end": 12, "note": "Controller-owned"
            }),
        )
        .await;
    assert_eq!(finding["ok"], true);

    let launch = run
        .structured(
            84,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 1,
                "prompt": "Implement this item", "required_skills": ["tdd"],
                "stage_skills": ["tdd"]
            }),
        )
        .await;
    assert_eq!(
        launch["launch_bindings"][0]["prompt"],
        "Implement this item"
    );
    assert_eq!(launch["launch_bindings"][0]["stage_skills"], json!(["tdd"]));
    let unknown_provider = run
        .structured(
            841,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2,
                "prompt": "Must not persist", "agent": "future"
            }),
        )
        .await;
    assert_eq!(unknown_provider["code"], "unknown_agent");
    assert_eq!(unknown_provider["field"], "agent");
    let deactivated_provider = run
        .structured(
            842,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2,
                "prompt": "Must not persist", "agent": "disabled"
            }),
        )
        .await;
    assert_eq!(deactivated_provider["code"], "provider_not_activated");
    let preserved = run
        .structured(
            85,
            "upsert_issue_type_workflow_launch_binding",
            json!({"type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2}),
        )
        .await;
    assert_eq!(
        preserved["launch_bindings"][0]["prompt"],
        "Implement this item"
    );
    assert_eq!(
        preserved["launch_bindings"][0]["stage_skills"],
        json!(["tdd"])
    );
    assert_eq!(preserved["workflow_revision"], 2);

    let mcp_null = run
        .structured(
            86,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2,
                "prompt": null
            }),
        )
        .await;
    assert_eq!(mcp_null["code"], "field_validation");

    let graphql = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &directory.path().join("media"),
        &graphql,
    )
    .await
    .unwrap();
    let graphql_null: Value = serde_json::from_str(
        &graphql
            .graphql_execute(
                json!({
                    "query": format!(
                        "mutation {{ upsert_issue_type_launch_binding(issue_type_id: \"{TASK_TYPE}\", state_id: \"{BACKLOG}\", workflow_revision: 2, prompt: null) {{ prompt }} }}"
                    )
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert_eq!(
        graphql_null["errors"][0]["extensions"]["code"], mcp_null["code"],
        "{graphql_null}"
    );

    let details = run
        .structured(9, "get_task_details", json!({"id_or_key": "AUTH-1"}))
        .await;
    assert_eq!(details["result"]["name"], "First updated");
    assert_eq!(
        details["result"]["description"],
        "First note\n\nSecond note"
    );
    assert_eq!(details["result"]["key"], "AUTH-1");
    let graph = run
        .structured(10, "get_dependency_graph", json!({"root_task_id": parent}))
        .await;
    assert_eq!(graph["nodes"].as_array().unwrap().len(), 2);

    let executed = run
        .structured(
            11,
            "execute_dependency_graph",
            json!({"root_task_id": parent, "reset": true}),
        )
        .await;
    assert_eq!(executed["root_id"], parent);
    let launched = run
        .structured(
            12,
            "launch_default_coding_agent",
            json!({"id_or_key": parent}),
        )
        .await;
    assert_eq!(launched["error"], "module_folder_unusable", "{launched}");
    let run_ticket_transitioned = run
        .structured(
            121,
            "update_task_status",
            json!({
                "project_id": PROJECT,
                "task_id": "AUTH-900",
                "status_name": "Validation"
            }),
        )
        .await;
    assert_eq!(
        run_ticket_transitioned["ok"], true,
        "{run_ticket_transitioned}"
    );
    assert_eq!(run_ticket_transitioned["status"], "Validation");
    let terminated = run.structured(13, "terminate_current_run", json!({})).await;
    assert_eq!(terminated["agent_run_id"], "run-valid", "{terminated}");
    assert_eq!(terminated["termination_requested"], true);
    assert_eq!(terminated["terminated"], false);
    assert_eq!(terminated["already_terminated"], false);
    // Rust authorized the run and owns its terminal outcome; the Python
    // boundary only executed the effect.
    let (ended_at, events) = wait_for_terminal_record(&directory).await;
    assert!(ended_at.is_some(), "the terminal outcome was not recorded");
    assert_eq!(events, 1);

    // A caller can lose the first response when its own terminal exits. The
    // run-bound credential therefore keeps this one tool retryable, while the
    // durable effect remains single-shot.
    let repeated = run.structured(14, "terminate_current_run", json!({})).await;
    assert_eq!(repeated["ok"], true, "{repeated}");
    assert_eq!(repeated["agent_run_id"], "run-valid", "{repeated}");
    assert_eq!(repeated["terminated"], true, "{repeated}");
    assert_eq!(repeated["already_terminated"], true, "{repeated}");
    assert_eq!(terminal_record(&directory).await, (ended_at, 1));

    let external_create = global
        .call(
            15,
            "create_task",
            json!({
                "project_id": PROJECT,
                "name": "Created externally",
                "issue_type": "Story"
            }),
        )
        .await;
    assert!(
        external_create["result"]["structuredContent"]["result"]
            .as_str()
            .is_some(),
        "{external_create}"
    );

    runtime.shutdown().await;
}
