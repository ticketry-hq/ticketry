use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;

use super::test_support::{SocketClient, PROJECT};
use super::*;

const OTHER_PROJECT: &str = "20000000-0000-0000-0000-000000000000";

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
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE agent_runs (
                id varchar PRIMARY KEY, issue_id char(32) NOT NULL, ticket_seq integer,
                agent varchar, model varchar, reasoning varchar, status varchar NOT NULL,
                started_at varchar NOT NULL, ended_at varchar, exit_code integer, error varchar,
                cwd varchar, provider_session_id varchar, lifecycle_state varchar,
                lifecycle_updated_at varchar, design_dir varchar, resumed_from varchar,
                scope varchar NOT NULL, launch_state varchar, launch_model varchar,
                initial_prompt text, launch_reasoning varchar,
                launch_unattended bool NOT NULL DEFAULT 0
            );
            INSERT INTO worktracker_project VALUES
                ('10000000000000000000000000000000',
                 'Authorized', 'AUTH', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
                ('20000000000000000000000000000000',
                 'Foreign', 'OTHER', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_issue VALUES
                ('30000000000000000000000000000000',
                 '10000000000000000000000000000000', 'task',
                 '40000000000000000000000000000000', NULL, NULL, NULL, 0,
                 'Authorized caller', 1, 0, 'A', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
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
    database.close().await.expect("close MCP fixture writer");
}

fn call(id: u64, name: &str, arguments: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})
}

fn run_envelope(authorization: &str) -> Value {
    json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-valid", "authorization": authorization})
}

#[tokio::test]
async fn socket_is_bound_privately_inside_the_data_directory_and_removed_on_shutdown() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());

    let runtime = start(directory.path(), &ownership).await;

    let socket = runtime.socket_path().to_path_buf();
    assert_eq!(socket, directory.path().join("mcp.sock"));
    let metadata = std::fs::symlink_metadata(&socket).unwrap();
    assert!(std::os::unix::fs::FileTypeExt::is_socket(
        &metadata.file_type()
    ));
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert!(runtime.is_running());

    runtime.shutdown().await;
    assert!(
        !socket.exists(),
        "shutdown must remove the socket it created"
    );
}

#[tokio::test]
async fn a_live_listener_is_not_displaced_by_a_second_start() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let first = start(directory.path(), &ownership).await;

    let failure = McpRuntime::start(configuration(directory.path()), &ownership)
        .await
        .err()
        .expect("a live socket must refuse a second listener");

    assert!(failure.is_socket_in_use(), "{failure}");
    assert!(matches!(failure, McpStartupError::SocketInUse { .. }));
    let mut client = SocketClient::connect_global(first.socket_path()).await;
    let pinged = client.structured(1, "mcp_ping", json!({})).await;
    assert_eq!(
        pinged["status"], "ok",
        "the first listener must keep serving"
    );
    first.shutdown().await;
}

#[tokio::test]
async fn a_stale_socket_is_reclaimed_but_a_non_socket_entry_is_left_alone() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let socket = mcp_socket_path(directory.path());
    // A socket whose owner died: bound, then abandoned without unlinking.
    let stale = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    drop(stale);
    assert!(socket.exists());

    let runtime = start(directory.path(), &ownership).await;
    let mut client = SocketClient::connect_global(runtime.socket_path()).await;
    assert_eq!(
        client.structured(1, "mcp_ping", json!({})).await["status"],
        "ok"
    );
    runtime.shutdown().await;

    std::fs::write(&socket, b"not a socket").unwrap();
    let failure = McpRuntime::start(configuration(directory.path()), &ownership)
        .await
        .err()
        .expect("a regular file on the socket path must fail startup");
    assert!(!failure.is_socket_in_use());
    assert!(
        failure.to_string().contains("non-socket entry"),
        "{failure}"
    );
    assert_eq!(std::fs::read(&socket).unwrap(), b"not a socket");
}

#[tokio::test]
async fn shutdown_removes_only_the_socket_this_runtime_created() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let socket = runtime.socket_path().to_path_buf();
    std::fs::remove_file(&socket).unwrap();
    let replacement = std::os::unix::net::UnixListener::bind(&socket).unwrap();

    runtime.shutdown().await;

    assert!(
        socket.exists(),
        "a replacement socket must survive our shutdown"
    );
    drop(replacement);
}

#[tokio::test]
async fn an_overlong_socket_path_is_an_explicit_startup_error() {
    let directory = tempfile::tempdir().unwrap();
    let deep = directory.path().join("x".repeat(120));
    std::fs::create_dir_all(&deep).unwrap();
    create_empty_database(&deep).await;
    let ownership = own(&deep);

    let failure = McpRuntime::start(configuration(&deep), &ownership)
        .await
        .err()
        .expect("an overlong socket path must fail");

    assert!(
        failure.to_string().contains("Unix sockets allow at most"),
        "{failure}"
    );
    assert!(!mcp_socket_path(&deep).exists());
}

#[tokio::test]
async fn database_startup_failure_retains_context_without_collision_classification() {
    let directory = tempfile::tempdir().unwrap();
    let ownership = own(directory.path());

    let failure = match McpRuntime::start(
        McpConfiguration {
            database_path: directory.path().to_path_buf(),
            media_root: directory.path().join("media"),
        },
        &ownership,
    )
    .await
    {
        Ok(_) => panic!("a directory cannot be opened as the MCP database"),
        Err(failure) => failure,
    };

    assert!(!failure.is_socket_in_use());
    assert!(matches!(failure, McpStartupError::Other { .. }));
    let diagnostic = failure.to_string();
    let detail = diagnostic
        .strip_prefix("could not open WorkTracker commands for MCP:")
        .unwrap_or_else(|| panic!("{diagnostic}"));
    assert!(!detail.trim().is_empty(), "{diagnostic}");
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
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 31);
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
async fn concurrent_clients_each_receive_their_own_responses() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let socket = runtime.socket_path().to_path_buf();

    let clients = (0..8).map(|index| {
        let socket = socket.clone();
        tokio::spawn(async move {
            let mut client = SocketClient::connect_global(&socket).await;
            let id = 100 + index;
            let response = client.call(id, "mcp_ping", json!({})).await;
            assert_eq!(response["id"], id, "{response}");
            assert_eq!(response["result"]["structuredContent"]["status"], "ok");
        })
    });
    for client in clients {
        client.await.unwrap();
    }

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_reconnecting_run_is_authorized_again_from_the_persistent_grant_store() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let first = start(directory.path(), &ownership).await;
    let authorization = first
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(first.socket_path(), "run-valid", &authorization).await;
    assert_eq!(
        client.structured(1, "list_projects", json!({})).await["result"][0]["id"],
        PROJECT
    );
    first.shutdown().await;
    assert!(
        client.is_closed().await,
        "shutdown must end live connections"
    );

    let second = start(directory.path(), &ownership).await;
    let mut client =
        SocketClient::connect_run(second.socket_path(), "run-valid", &authorization).await;
    assert_eq!(
        client.structured(2, "list_projects", json!({})).await["result"][0]["id"],
        PROJECT
    );
    let (mut foreign, verdict) = SocketClient::handshake(
        second.socket_path(),
        json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-other", "authorization": authorization}),
    )
    .await;
    assert_eq!(verdict["reason"], "authorization_foreign_run");
    assert!(foreign.is_closed().await);
    second.shutdown().await;
}

#[tokio::test]
async fn listener_returns_structured_unavailable_until_runtime_reconciliation_finishes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    ticketry_settings::publish_readiness(
        directory.path(),
        &ticketry_settings::Slice2Readiness::unavailable(),
    )
    .expect("close readiness");
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test(
            "run-valid",
            "starting",
            allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();

    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer starting").await;
    let response = client.structured(1, "list_projects", json!({})).await;
    assert_eq!(response["code"], "service_unavailable", "{response:#}");
    assert_eq!(response["phase"], "runtime-reconciliation");

    runtime.shutdown().await;
}

#[test]
fn mcp_dispatch_has_no_backend_http_authorization_path() {
    let module = include_str!("lib.rs");
    let service = include_str!("service.rs");
    let authority = include_str!("../../../worktracking/ticketry-runs/src/authority/authority.rs");

    assert!(!module.contains("backend_base_url"));
    assert!(!module.contains("backend_api_key"));
    assert!(!service.contains("reqwest"));
    assert!(!authority.contains("reqwest"));
    assert!(!std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("backend_port.rs")
        .exists());
}

#[test]
fn mcp_write_adapters_do_not_own_seaorm_queries_or_domain_sequencing() {
    let dependency = include_str!("dependency_tools.rs");
    let dispatch = include_str!("dispatch.rs");
    let workflow = include_str!("workflow_tools.rs");
    for (name, source) in [
        ("dependency_tools.rs", dependency),
        ("dispatch.rs", dispatch),
        ("workflow_tools.rs", workflow),
    ] {
        for forbidden in [
            "EntityTrait",
            "QueryFilter",
            "ActiveModelTrait",
            "::Entity::",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} imports SeaORM query capability {forbidden}"
            );
        }
    }
    assert!(!dependency.contains("blockers::replace"));
    assert_eq!(dependency.matches("blockers::change(").count(), 2);

    let append = dispatch
        .split("async fn append_description")
        .nth(1)
        .unwrap()
        .split("async fn update_status")
        .next()
        .unwrap();
    assert_eq!(append.matches("work_items::append_description(").count(), 1);
    assert!(!append.contains("work_items::update("));

    let finding = dispatch
        .split("async fn create_review_finding")
        .nth(1)
        .unwrap()
        .split("fn hyphenate")
        .next()
        .unwrap();
    assert_eq!(
        finding
            .matches("work_items::create_review_finding(")
            .count(),
        1
    );
    assert!(!finding.contains("read_queries"));

    let launch = workflow
        .split("async fn upsert_launch_binding")
        .nth(1)
        .unwrap()
        .split("pub fn rejection")
        .next()
        .unwrap();
    assert_eq!(launch.matches("workflow::patch_launch_binding(").count(), 1);
    assert!(!launch.contains("read_queries::launch_bindings"));
}
