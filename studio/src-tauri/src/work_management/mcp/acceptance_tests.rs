use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use tauri_graphql::{TransportApi, TransportApiImpl};
use tokio::time::{timeout, Duration};

mod termination;

use super::tests::{post, start_authorizer, PROJECT};
use super::{loopback, McpConfiguration, McpRuntime};
use crate::entities::terminals::session;
use crate::graphql_foundation::initialize_with_worktracker_commands_and_install;
use crate::terminal::cleanup::{
    CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime,
};

const TASK_TYPE: &str = "30000000-0000-0000-0000-000000000001";
const BACKLOG: &str = "40000000-0000-0000-0000-000000000001";
const REVIEW: &str = "40000000-0000-0000-0000-000000000002";
const MODULE: &str = "20000000-0000-0000-0000-000000000001";

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

async fn prepare_command_database(directory: &tempfile::TempDir) {
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open MCP command fixture");
    database
        .execute_unprepared(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                onboarding_required bool NOT NULL
            );
            CREATE TABLE worktracker_state (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, "group" varchar(32) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                is_protected bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, level varchar(16) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                start_state_id char(32), workflow_revision integer NOT NULL,
                is_pathfind bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id),
                FOREIGN KEY(parent_id) REFERENCES worktracker_issue(id) ON DELETE SET NULL
            );
            CREATE TABLE worktracker_issue_blocked_by (
                id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
                to_issue_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_attachment (
                id char(32) PRIMARY KEY, issue_id char(32) NOT NULL,
                file varchar(100) NOT NULL, filename varchar(512) NOT NULL,
                mime_type varchar(255) NOT NULL, size integer,
                created_at datetime NOT NULL
            );
            CREATE TABLE worktracker_provider (
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE,
                activated bool NOT NULL, supports_unattended bool NOT NULL
            );
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY(scope, "key")
            );
            CREATE TABLE worktracker_issuetypetransition (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
                agent_allowed bool NOT NULL,
                UNIQUE(issue_type_id, from_state_id, to_state_id)
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL, prompt text NOT NULL,
                required_skills text NOT NULL, model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(issue_type_id, state_id)
            );
            CREATE TABLE agent_runs (
                id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER,
                agent TEXT NOT NULL, status TEXT NOT NULL,
                started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, error TEXT,
                cwd TEXT, provider_session_id TEXT, lifecycle_state TEXT,
                lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
                scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT,
                initial_prompt TEXT, launch_reasoning TEXT,
                launch_unattended BOOLEAN NOT NULL DEFAULT 0
            );
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
                tmux_session_name TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
                module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
                terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,
                runtime_cleanup_pending BOOL NOT NULL DEFAULT 0, runtime_namespace TEXT,
                output_identity TEXT, output_sequence INTEGER NOT NULL DEFAULT 0,
                last_output_at TEXT, agent TEXT
            );
            CREATE TABLE terminal_cleanup_effects (
                effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL UNIQUE
                    REFERENCES agent_terminal_sessions(agent_run_id) ON DELETE CASCADE,
                cause TEXT NOT NULL, state TEXT NOT NULL, lease_owner TEXT,
                lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error_code TEXT, last_error_message TEXT, runtime_evidence TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, applied_at TEXT
            );
            INSERT INTO worktracker_project VALUES
                ('10000000000000000000000000000000',
                 'Authorized', 'AUTH', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('40000000000000000000000000000001', '10000000000000000000000000000000',
                 'Backlog', 'backlog', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('40000000000000000000000000000002', '10000000000000000000000000000000',
                 'Review', 'started', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('30000000000000000000000000000001', '10000000000000000000000000000000',
                 'Story', 'task', '', 0, '40000000000000000000000000000001', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000002', '10000000000000000000000000000000',
                 'Implementation', 'task', '', 1, '40000000000000000000000000000001', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000003', '10000000000000000000000000000000',
                 'Module', 'module', '', 2, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('20000000000000000000000000000001', '10000000000000000000000000000000',
                 'module', '30000000000000000000000000000003', NULL, NULL, NULL, 0,
                 'Module', 0, 0, 'M', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000000', '10000000000000000000000000000000',
                 'task', '30000000000000000000000000000002', NULL,
                 '20000000000000000000000000000001', '40000000000000000000000000000001', 0,
                 'Authenticated caller', 900, 0, 'Z', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO agent_runs
                (id, issue_id, agent, status, started_at, scope)
                VALUES ('run-valid', '30000000000000000000000000000000', 'codex',
                        'running', '2026-08-15T00:00:00+00:00', 'task');
            INSERT INTO agent_terminal_sessions
                (agent_run_id, tmux_session_name, task_id, module_id, project_id,
                 created_at, scope, runtime_namespace, agent)
                VALUES ('run-valid', 'pt-run-valid',
                        '30000000000000000000000000000000',
                        '20000000000000000000000000000001',
                        '10000000000000000000000000000000',
                        '2026-08-15T00:00:00+00:00', 'task', 'fixture-runtime', 'codex');
            INSERT INTO worktracker_provider VALUES
                ('50000000000000000000000000000001', 'codex', 1, 1),
                ('50000000000000000000000000000002', 'disabled', 0, 1);
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog',
                 '{"global_default":{"provider":"codex","model":null,"reasoning":null}}',
                 CURRENT_TIMESTAMP);
            "#,
        )
        .await
        .expect("create MCP command fixture");
    crate::work_management::module_presentation_migration::install(&database)
        .await
        .expect("install final module-presentation shape");
    database.close().await.expect("close MCP command fixture");
}

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

async fn call(url: &str, id: u64, name: &str, arguments: Value) -> Value {
    post(
        url,
        Some("Bearer valid"),
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments}
        }),
    )
    .await
    .json::<Value>()
    .await
    .expect("decode MCP tool result")["result"]["structuredContent"]
        .clone()
}

#[tokio::test]
async fn mcp_mutations_cover_crud_hierarchy_workflow_and_blockers_through_rust_commands() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (_backend_address, backend_shutdown, backend_task) = start_authorizer().await;
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            address: loopback(0).unwrap(),
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
            ingress_credential: "fixture-key".to_owned(),
        },
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test(
            "run-valid",
            "valid",
            super::allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();
    let url = format!("http://{}/mcp", runtime.address());

    let external_projects = post(
        &url,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "tools/call",
            "params": {
                "name": "list_projects",
                "arguments": {}
            }
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        external_projects["result"]["structuredContent"]["result"][0]["id"],
        PROJECT
    );

    let first_output = call(
        &url,
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
    let second = call(
        &url,
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
    let parent = call(
        &url,
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

    let updated = call(
        &url,
        4,
        "update_task",
        json!({
            "id_or_key": first, "name": "First updated"
        }),
    )
    .await;
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["updated_fields"], json!(["name"]));

    let blocked = call(
        &url,
        5,
        "set_task_blockers",
        json!({
            "task_id": second, "blocked_by_ids": [first]
        }),
    )
    .await;
    assert_eq!(blocked["blocked_by_ids"], json!([first]));

    let reparented = call(
        &url,
        6,
        "reparent_tasks",
        json!({
            "project_id": PROJECT, "parent_task_id": parent, "task_ids": [second]
        }),
    )
    .await;
    assert_eq!(reparented["reparented"][0]["task_id"], second);

    let workflow = call(
        &url,
        7,
        "add_issue_type_workflow_transition",
        json!({
            "type_id": TASK_TYPE, "from_state_id": BACKLOG, "to_state_id": REVIEW,
            "workflow_revision": 0
        }),
    )
    .await;
    assert_eq!(workflow["workflow_revision"], 1);
    let transitioned = call(
        &url,
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
        call(
            &url,
            81,
            "append_task_description",
            json!({"project_id": PROJECT, "task_id": first, "new_content": "First note"}),
        )
        .await["result"],
        true
    );
    assert_eq!(
        call(
            &url,
            82,
            "append_task_description",
            json!({"project_id": PROJECT, "task_id": first, "new_content": "Second note"}),
        )
        .await["result"],
        true
    );
    let finding = call(
        &url,
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

    let launch = call(
        &url,
        84,
        "upsert_issue_type_workflow_launch_binding",
        json!({
            "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 1,
            "prompt": "Implement this item", "required_skills": ["tdd"]
        }),
    )
    .await;
    assert_eq!(
        launch["launch_bindings"][0]["prompt"],
        "Implement this item"
    );
    let unknown_provider = call(
        &url,
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
    let deactivated_provider = call(
        &url,
        842,
        "upsert_issue_type_workflow_launch_binding",
        json!({
            "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2,
            "prompt": "Must not persist", "agent": "disabled"
        }),
    )
    .await;
    assert_eq!(deactivated_provider["code"], "provider_not_activated");
    let preserved = call(
        &url,
        85,
        "upsert_issue_type_workflow_launch_binding",
        json!({"type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 2}),
    )
    .await;
    assert_eq!(
        preserved["launch_bindings"][0]["prompt"],
        "Implement this item"
    );
    assert_eq!(preserved["workflow_revision"], 2);

    let mcp_null = call(
        &url,
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

    let details = call(&url, 9, "get_task_details", json!({"id_or_key": "AUTH-1"})).await;
    assert_eq!(details["result"]["name"], "First updated");
    assert_eq!(
        details["result"]["description"],
        "First note\n\nSecond note"
    );
    assert_eq!(details["result"]["key"], "AUTH-1");
    let graph = call(
        &url,
        10,
        "get_dependency_graph",
        json!({"root_task_id": parent}),
    )
    .await;
    assert_eq!(graph["nodes"].as_array().unwrap().len(), 2);

    let executed = call(
        &url,
        11,
        "execute_dependency_graph",
        json!({"root_task_id": parent, "reset": true}),
    )
    .await;
    assert_eq!(executed["root_id"], parent);
    let launched = call(
        &url,
        12,
        "launch_default_coding_agent",
        json!({"id_or_key": parent}),
    )
    .await;
    assert_eq!(launched["error"], "module_folder_unusable", "{launched}");
    let terminated = call(&url, 13, "terminate_current_run", json!({})).await;
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
    let repeated = call(&url, 14, "terminate_current_run", json!({})).await;
    assert_eq!(repeated["ok"], true, "{repeated}");
    assert_eq!(repeated["agent_run_id"], "run-valid", "{repeated}");
    assert_eq!(repeated["terminated"], true, "{repeated}");
    assert_eq!(repeated["already_terminated"], true, "{repeated}");
    assert_eq!(terminal_record(&directory).await, (ended_at, 1));

    let external_create = post(
        &url,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 15,
            "method": "tools/call",
            "params": {
                "name": "create_task",
                "arguments": {
                    "project_id": PROJECT,
                    "name": "Created externally",
                    "issue_type": "Story"
                }
            }
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert!(
        external_create["result"]["structuredContent"]["result"]
            .as_str()
            .is_some(),
        "{external_create}"
    );

    runtime.shutdown().await;
    backend_shutdown.cancel();
    backend_task.await.unwrap();
}
