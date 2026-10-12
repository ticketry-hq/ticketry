use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;

use super::test_support::{SocketClient, PROJECT};
use super::*;

pub(super) const OTHER_PROJECT: &str = "20000000-0000-0000-0000-000000000000";

fn configuration(directory: &Path) -> McpConfiguration {
    McpConfiguration {
        database_path: directory.join("state.db"),
        media_root: directory.join("media"),
    }
}

async fn create_empty_database(directory: &Path) {
    let database_path = directory.join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", database_path.display()))
        .await
        .expect("create empty fixture database");
    database.close().await.expect("close fixture writer");
}

pub(super) async fn start(directory: &Path, ownership: &DataDirectoryGuard) -> McpRuntime {
    McpRuntime::start(configuration(directory), ownership)
        .await
        .expect("start MCP runtime")
}

fn own(directory: &Path) -> DataDirectoryGuard {
    DataDirectoryGuard::acquire(directory).expect("own the fixture data directory")
}

async fn prepare_projects(directory: &Path) {
    let path = directory.join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open MCP fixture writer");
    database
        .execute_unprepared(
            r#"
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                onboarding_required bool NOT NULL
            );
            CREATE TABLE worktracker_issue (
                sprint_id char(32) NULL, id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, level varchar(16) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                start_state_id char(32), workflow_revision integer NOT NULL,
                is_pathfind bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue_blocked_by (
                id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
                to_issue_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_label (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, color varchar(32) NOT NULL DEFAULT '',
                UNIQUE(project_id, name)
            );
            CREATE TABLE worktracker_issue_labels (
                id integer PRIMARY KEY AUTOINCREMENT,
                issue_id char(32) NOT NULL, label_id char(32) NOT NULL,
                UNIQUE(issue_id, label_id)
            );
            CREATE TABLE agent_runs (
                id varchar PRIMARY KEY, issue_id char(32) NOT NULL, ticket_seq integer,
                agent varchar, model varchar, reasoning varchar, status varchar NOT NULL,
                started_at varchar NOT NULL, ended_at varchar, exit_code integer, error varchar,
                cwd varchar, provider_session_id varchar, lifecycle_state varchar,
                lifecycle_updated_at varchar, design_dir varchar, resumed_from varchar,
                scope varchar NOT NULL, launch_state varchar, launch_model varchar,
                initial_prompt text, launch_reasoning varchar,
                launch_unattended bool NOT NULL DEFAULT 0, attention_reason text
            );
            INSERT INTO worktracker_project VALUES
                ('10000000000000000000000000000000',
                 'Authorized', 'AUTH', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
                ('20000000000000000000000000000000',
                 'Foreign', 'OTHER', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, parent_id, module_id, state_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES ('30000000000000000000000000000000',
                 '10000000000000000000000000000000', 'task',
                 '40000000000000000000000000000000', NULL, NULL, NULL, 0,
                 'Authorized caller', 1, 0, 'A', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('40000000000000000000000000000000',
                 '10000000000000000000000000000000', 'Story', 'task', '', 0,
                 NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO agent_runs
                (id, issue_id, status, started_at, scope)
                VALUES ('run-valid', '30000000000000000000000000000000',
                        'running', CURRENT_TIMESTAMP, 'task');
            "#,
        )
        .await
        .expect("create MCP project fixture");
    ticketry_work_management::module_presentation_migration::install(&database)
        .await
        .expect("install final module-presentation shape");
    let table = sea_orm::Schema::new(sea_orm::DbBackend::Sqlite)
        .create_table_from_entity(ticketry_entities::app_settings::Entity);
    database
        .execute_raw(sea_orm::DbBackend::Sqlite.build(&table))
        .await
        .unwrap();
    database.close().await.expect("close MCP fixture writer");
}

fn run_envelope(authorization: &str) -> Value {
    json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-valid", "authorization": authorization})
}

#[tokio::test]
async fn handshake_refusals_never_reach_the_json_rpc_decoder() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    runtime
        .grant_for_test("run-valid", "expired", allowed_provider_operations(), true)
        .await
        .unwrap();
    let socket = runtime.socket_path();

    for (envelope, reason) in [
        (
            json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
            "handshake_malformed",
        ),
        (
            json!({"ticketry_mcp_auth": 2, "mode": "global"}),
            "handshake_unsupported_version",
        ),
        (
            json!({"ticketry_mcp_auth": 1, "mode": "root"}),
            "handshake_mode_unknown",
        ),
        (
            json!({"ticketry_mcp_auth": 1, "mode": "run"}),
            "handshake_run_missing",
        ),
        (
            json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-valid"}),
            "authorization_missing",
        ),
        (run_envelope("Bearer nope"), "authorization_invalid"),
        (run_envelope("Bearer expired"), "authorization_expired"),
        (run_envelope("Token valid"), "authorization_malformed"),
        (
            json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-other", "authorization": "Bearer valid"}),
            "authorization_foreign_run",
        ),
    ] {
        let (mut client, verdict) = SocketClient::handshake(socket, envelope.clone()).await;
        assert_eq!(verdict["ticketry_mcp_auth"], 1, "{envelope} -> {verdict}");
        assert_eq!(verdict["ok"], false, "{envelope} -> {verdict}");
        assert_eq!(verdict["reason"], reason, "{envelope} -> {verdict}");
        assert!(
            client.is_closed().await,
            "{envelope} must close the connection"
        );
    }

    // An oversized first line is refused before it is parsed.
    let huge = json!({"ticketry_mcp_auth": 1, "mode": "global", "padding": "p".repeat(9000)});
    let (mut client, verdict) = SocketClient::handshake(socket, huge).await;
    assert_eq!(verdict["reason"], "handshake_too_large", "{verdict}");
    assert!(client.is_closed().await);

    runtime.shutdown().await;
}

#[tokio::test]
async fn global_connections_read_everything_while_run_connections_stay_scoped() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    runtime
        .grant_for_test(
            "run-valid",
            "read-only",
            ["list_projects".to_owned()],
            false,
        )
        .await
        .unwrap();
    let socket = runtime.socket_path();

    let mut global = SocketClient::connect_global(socket).await;
    let listed = global
        .request(json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}))
        .await;
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 35);
    assert_eq!(listed["result"]["ttlMs"], 0, "{listed:#}");
    assert_eq!(listed["result"]["cacheScope"], "private", "{listed:#}");
    let projects = global.structured(2, "list_projects", json!({})).await;
    assert_eq!(projects["result"].as_array().unwrap().len(), 2);
    let termination = global
        .structured(3, "terminate_current_run", json!({}))
        .await;
    assert_eq!(termination["reason"], "authorization_missing");

    let mut run = SocketClient::connect_run(socket, "run-valid", "Bearer valid").await;
    let foreign = run
        .structured(4, "list_modules", json!({"project_id": OTHER_PROJECT}))
        .await;
    assert_eq!(foreign["code"], "foreign_scope", "{foreign:#}");
    let own_projects = run.structured(5, "list_projects", json!({})).await;
    assert_eq!(own_projects["result"][0]["id"], PROJECT);
    let run_now = run
        .structured(6, "run_now", json!({"id_or_key": "CODING-912"}))
        .await;
    assert_eq!(run_now["code"], "run_now_unavailable");
    assert_eq!(run_now["committed_state"], Value::Null);

    let mut read_only = SocketClient::connect_run(socket, "run-valid", "Bearer read-only").await;
    let disallowed = read_only
        .structured(
            7,
            "update_task",
            json!({"id_or_key": "AUTH-1", "name": "no"}),
        )
        .await;
    assert_eq!(disallowed["reason"], "authorization_tool_disallowed");

    runtime.shutdown().await;
}

#[tokio::test]
async fn add_task_tags_rejects_non_string_values_at_the_public_tool_boundary() {
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

    let rejected = run
        .structured(
            1,
            "add_task_tags",
            json!({
                "id_or_key": "30000000-0000-0000-0000-000000000000",
                "tags": ["backend", 7]
            }),
        )
        .await;

    assert_eq!(rejected["ok"], false, "{rejected:#}");
    assert_eq!(rejected["code"], "validation", "{rejected:#}");
    assert_eq!(rejected["field"], "tags", "{rejected:#}");
    runtime.shutdown().await;
}

#[tokio::test]
async fn add_task_tags_is_additive_and_idempotent_over_the_socket() {
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

    let added = run
        .structured(
            1,
            "add_task_tags",
            json!({
                "id_or_key": "30000000-0000-0000-0000-000000000000",
                "tags": [" backend ", "", "backend", "Needs Review"]
            }),
        )
        .await;
    assert_eq!(added["ok"], true, "{added:#}");
    assert_eq!(added["tags"], json!(["Needs Review", "backend"]));

    let repeated = run
        .structured(
            2,
            "add_task_tags",
            json!({
                "id_or_key": "30000000-0000-0000-0000-000000000000",
                "tags": ["backend"]
            }),
        )
        .await;
    assert_eq!(repeated["tags"], added["tags"]);
    runtime.shutdown().await;
}

mod adapter_boundaries;
mod connection_sessions;
mod socket_lifecycle;
mod typed_dependency_launch_tools;
mod typed_run_only_provider_tools;
mod typed_tool_surface;
mod typed_work_item_tools;
mod typed_workflow_policy_tools;
