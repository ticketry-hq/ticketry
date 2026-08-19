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
    backend: SocketAddr,
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
        backend_base_url: format!("http://{backend}/api"),
        backend_api_key: "fixture-key".to_owned(),
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
                id char(32) PRIMARY KEY, workspace_id char(32) NOT NULL,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_project VALUES
                ('10000000000000000000000000000000', '90000000000000000000000000000000',
                 'Authorized', 'AUTH', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('20000000000000000000000000000000', '90000000000000000000000000000000',
                 'Foreign', 'OTHER', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        )
        .await
        .expect("create MCP project fixture");
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
                .route("/api/terminals/mcp-authorize", route_post(authorize))
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
async fn listener_lists_the_thirty_tools_and_recovers_on_the_same_port() {
    let directory = tempfile::tempdir().unwrap();
    let (backend, backend_cancellation, backend_task) = start_authorizer().await;
    let first = start(&directory, 0, backend).await;
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
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 30);
    first.shutdown().await;

    let second = start(&directory, port, backend).await;
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
async fn run_authorization_survives_restart_and_rejects_bad_or_foreign_scope() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(&directory).await;
    let (backend_address, backend_shutdown, backend_task) = start_authorizer().await;
    let configuration = |port| McpConfiguration {
        address: loopback(port).unwrap(),
        database_path: directory.path().join("state.db"),
        media_root: directory.path().join("media"),
        backend_base_url: format!("http://{backend_address}/api"),
        backend_api_key: "fixture-key".to_owned(),
    };
    let first = McpRuntime::start(configuration(0)).await.unwrap();
    let port = first.address().port();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let call = |id, name: &str, arguments: Value| json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}});

    let missing = post(&url, None, call(1, "list_projects", json!({})))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        missing["result"]["structuredContent"]["reason"],
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
        foreign["result"]["structuredContent"]["code"],
        "foreign_scope"
    );

    first.shutdown().await;
    let second = McpRuntime::start(configuration(port)).await.unwrap();
    let valid = post(
        &url,
        Some("Bearer valid"),
        call(4, "list_projects", json!({})),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        valid["result"]["structuredContent"]["result"][0]["id"],
        PROJECT
    );

    second.shutdown().await;
    backend_shutdown.cancel();
    backend_task.await.unwrap();
}
