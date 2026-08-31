//! Fixture MCP authorizer and HTTP helpers shared by this crate's own tests and
//! by the root package's `mcp_acceptance` integration binary, which drives the
//! listener against the assembled GraphQL schema and therefore cannot live in
//! this crate. Compiled only for this crate's tests and for the `test-support`
//! feature that dev-dependencies turn on.

use std::net::SocketAddr;

use axum::{
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post as route_post,
    Router,
};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::loopback;

pub const PROJECT: &str = "10000000-0000-0000-0000-000000000000";

pub async fn post(url: &str, authorization: Option<&str>, body: Value) -> reqwest::Response {
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

pub async fn start_authorizer() -> (SocketAddr, CancellationToken, JoinHandle<()>) {
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
