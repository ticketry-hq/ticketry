use axum::{
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post as route_post,
};
use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};

use super::*;

pub(super) const PROJECT: &str = "10000000-0000-0000-0000-000000000000";
const OTHER_PROJECT: &str = "20000000-0000-0000-0000-000000000000";

pub(super) async fn post(url: &str, authorization: Option<&str>, body: Value) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-03-26")
        .json(&body);
    if let Some(authorization) = authorization {
        request = request.header("authorization", authorization);
    }
    request.send().await.expect("call in-process MCP")
}

pub(super) async fn start(
    directory: &tempfile::TempDir,
    port: u16,
    _backend: SocketAddr,
) -> McpRuntime {
    let database_path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", database_path.display()))
        .await
        .expect("create empty fixture database");
    database.close().await.expect("close fixture writer");
    McpRuntime::start(McpConfiguration {
        address: loopback(port).unwrap(),
        database_path,
        media_root: directory.path().join("media"),
        ingress_credential: "fixture-key".to_owned(),
    })
    .await
    .expect("start MCP runtime")
}

async fn prepare_projects(directory: &tempfile::TempDir) {
    let path = directory.path().join("state.db");
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
                scope varchar NOT NULL, launch_state varchar, launch_model varchar
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
    crate::work_management::module_presentation_migration::install(&database)
        .await
        .expect("install final module-presentation shape");
    database.close().await.expect("close MCP fixture writer");
}

async fn authorize(request: Request) -> Response {
    match request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
    {
        Some("Bearer valid") => axum::Json(json!({
            "agent_run_id": "run-valid",
            "issue_id": "30000000-0000-0000-0000-000000000000",
            "project_id": PROJECT,
            "scope": "task"
        }))
        .into_response(),
        Some("Bearer expired") => (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({
                "detail": "authorization_expired",
                "code": "caller_run_unbound"
            })),
        )
            .into_response(),
        _ => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({
                "detail": "caller_run_unknown",
                "code": "caller_run_unknown"
            })),
        )
            .into_response(),
    }
}

async fn forwarded_run_control(request: Request) -> Response {
    let authorized = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some("Bearer valid");
    let api_key = request
        .headers()
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        == Some("fixture-key");
    if !authorized || !api_key {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"detail": "authorization_missing"})),
        )
            .into_response();
    }
    let path = request.uri().path();
    if path.ends_with("/self-terminate") {
        return axum::Json(json!({
            "ok": true,
            "terminated": true,
            "already_terminated": false,
            "agent_run_id": "run-valid"
        }))
        .into_response();
    }
    let target_id = path.split('/').nth(4).unwrap_or_default();
    if path.ends_with("/launch-agent") {
        return axum::Json(json!({
            "target_id": target_id,
            "agent": "codex",
            "agent_run_id": "run-launched"
        }))
        .into_response();
    }
    axum::Json(json!({"root_id": target_id, "launched": []})).into_response()
}

async fn launch_policy_effect(request: Request) -> Response {
    let api_key = request
        .headers()
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        == Some("fixture-key");
    if !api_key {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"detail": "authorization_missing"})),
        )
            .into_response();
    }
    let body = axum::body::to_bytes(request.into_body(), usize::MAX)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or_default();
    let target_id = body["task_id"].as_str().unwrap_or_default();
    if body["caller_scope"] == "subtree" {
        return axum::Json(json!({"root_id": target_id, "launched": []})).into_response();
    }
    axum::Json(json!({
        "target_id": target_id,
        "agent": body["provider"],
        "agent_run_id": "run-launched"
    }))
    .into_response()
}

async fn launch_policy_readiness(request: Request) -> Response {
    let api_key = request
        .headers()
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        == Some("fixture-key");
    if !api_key {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"detail": "authorization_missing"})),
        )
            .into_response();
    }
    axum::Json(json!({
        "version": 1,
        "ready": true,
        "policy_owner": "rust",
        "effect_owner": "django",
        "django_write_fallback": false
    }))
    .into_response()
}

pub(super) async fn start_authorizer() -> (SocketAddr, CancellationToken, JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind(loopback(0).unwrap())
        .await
        .expect("bind fixture authorizer");
    let address = listener.local_addr().unwrap();
    let cancellation = CancellationToken::new();
    let shutdown = cancellation.clone();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/api/runs/mcp-authorize", route_post(authorize))
                .route(
                    "/api/terminals/self-terminate",
                    route_post(forwarded_run_control),
                )
                .route(
                    "/api/work-tracker/work-items/{task_id}/graph-run",
                    route_post(forwarded_run_control).delete(forwarded_run_control),
                )
                .route(
                    "/api/work-tracker/work-items/{task_id}/launch-agent",
                    route_post(forwarded_run_control),
                )
                .route(
                    "/api/execution/launch-policy-effects",
                    route_post(launch_policy_effect).get(launch_policy_readiness),
                ),
        )
        .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
        .await
        .unwrap();
    });
    (address, cancellation, task)
}

#[tokio::test]
async fn listener_lists_the_thirty_one_tools_and_recovers_on_the_same_port() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(&directory).await;
    let (backend, backend_cancellation, backend_task) = start_authorizer().await;
    let first = start(&directory, 0, backend).await;
    first
        .grant_for_test("run-valid", "first", allowed_provider_operations(), false)
        .await
        .unwrap();
    let port = first.address().port();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let listed = post(
        &url,
        None,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 31);
    first.shutdown().await;

    let second = start(&directory, port, backend).await;
    second
        .grant_for_test("run-valid", "second", allowed_provider_operations(), false)
        .await
        .unwrap();
    let pinged = post(
        &url,
        None,
        json!({
            "jsonrpc":"2.0","id":2,"method":"tools/call",
            "params":{"name":"mcp_ping","arguments":{}}
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(pinged["result"]["structuredContent"]["status"], "ok");
    second.shutdown().await;
    backend_cancellation.cancel();
    backend_task.await.unwrap();
}

#[tokio::test]
async fn listener_returns_structured_unavailable_until_runtime_reconciliation_finishes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(&directory).await;
    ticketry_settings::publish_readiness(
        directory.path(),
        &ticketry_settings::Slice2Readiness::unavailable(),
    )
    .expect("close readiness");
    let (backend, backend_cancellation, backend_task) = start_authorizer().await;
    let runtime = start(&directory, 0, backend).await;
    runtime
        .grant_for_test(
            "run-valid",
            "starting",
            allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();
    let url = format!("http://{}/mcp", runtime.address());
    let response = post(
        &url,
        Some("Bearer starting"),
        json!({
            "jsonrpc":"2.0","id":1,"method":"tools/call",
            "params":{"name":"list_projects","arguments":{}}
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        response["result"]["structuredContent"]["code"], "service_unavailable",
        "{response:#}"
    );
    assert_eq!(
        response["result"]["structuredContent"]["phase"],
        "runtime-reconciliation"
    );

    runtime.shutdown().await;
    backend_cancellation.cancel();
    backend_task.await.unwrap();
}

#[tokio::test]
async fn global_mcp_allows_task_tools_while_run_credentials_remain_scoped() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(&directory).await;
    let (_backend_address, backend_shutdown, backend_task) = start_authorizer().await;
    let configuration = |port| McpConfiguration {
        address: loopback(port).unwrap(),
        database_path: directory.path().join("state.db"),
        media_root: directory.path().join("media"),
        ingress_credential: "fixture-key".to_owned(),
    };
    let first = McpRuntime::start(configuration(0)).await.unwrap();
    first
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    first
        .grant_for_test("run-valid", "expired", allowed_provider_operations(), true)
        .await
        .unwrap();
    let port = first.address().port();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let call = |id, name: &str, arguments: Value| json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}});

    let malformed_lifecycle = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/runs/lifecycle"))
        .header("content-type", "application/json")
        .body("{")
        .send()
        .await
        .unwrap();
    assert_eq!(malformed_lifecycle.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        malformed_lifecycle.json::<Value>().await.unwrap()["reason"],
        "authorization_missing"
    );

    let missing = post(&url, None, call(1, "list_projects", json!({})))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        missing["result"]["structuredContent"]["result"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let unbound_termination = post(&url, None, call(8, "terminate_current_run", json!({})))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        unbound_termination["result"]["structuredContent"]["reason"],
        "authorization_missing"
    );

    let expired = post(
        &url,
        Some("Bearer expired"),
        call(2, "list_projects", json!({})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        expired["result"]["structuredContent"]["reason"],
        "authorization_expired"
    );

    let foreign = post(
        &url,
        Some("Bearer valid"),
        call(3, "list_modules", json!({"project_id": OTHER_PROJECT})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        foreign["result"]["structuredContent"]["code"], "foreign_scope",
        "{foreign:#}"
    );

    first
        .grant_for_test(
            "run-valid",
            "read-only",
            ["list_projects".to_owned()],
            false,
        )
        .await
        .unwrap();
    let disallowed = post(
        &url,
        Some("Bearer read-only"),
        call(
            4,
            "update_task",
            json!({"id_or_key": "AUTH-1", "name": "no"}),
        ),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        disallowed["result"]["structuredContent"]["reason"],
        "authorization_tool_disallowed"
    );

    first.shutdown().await;
    let second = McpRuntime::start(configuration(port)).await.unwrap();
    let recovered = post(
        &url,
        Some("Bearer valid"),
        call(5, "list_projects", json!({})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        recovered["result"]["structuredContent"]["result"][0]["id"],
        PROJECT
    );
    second
        .grant_for_test("run-valid", "current", allowed_provider_operations(), false)
        .await
        .unwrap();
    let valid = post(
        &url,
        Some("Bearer current"),
        call(6, "list_projects", json!({})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        valid["result"]["structuredContent"]["result"][0]["id"],
        PROJECT
    );
    let lifecycle = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/runs/lifecycle"))
        .header("authorization", "Bearer current")
        .json(&json!({
            "agent_run_id": "run-foreign",
            "kind": "stop",
            "occurred_at": "2026-08-23T00:00:00Z"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(lifecycle.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        lifecycle.json::<Value>().await.unwrap()["reason"],
        "authorization_foreign_run"
    );
    let run_now = post(
        &url,
        Some("Bearer current"),
        call(7, "run_now", json!({"id_or_key": "CODING-912"})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        run_now["result"]["structuredContent"]["code"],
        "run_now_unavailable"
    );
    assert_eq!(
        run_now["result"]["structuredContent"]["committed_state"],
        Value::Null
    );

    second.shutdown().await;
    backend_shutdown.cancel();
    backend_task.await.unwrap();
}

#[test]
fn mcp_dispatch_has_no_backend_http_authorization_path() {
    let module = include_str!("mod.rs");
    let service = include_str!("service.rs");
    let authority = include_str!("../run_authority/authority.rs");

    assert!(!module.contains("backend_base_url"));
    assert!(!module.contains("backend_api_key"));
    assert!(!service.contains("reqwest"));
    assert!(!authority.contains("reqwest"));
    assert!(!std::path::Path::new(file!())
        .parent()
        .expect("MCP module directory")
        .join("backend_port.rs")
        .exists());
}
