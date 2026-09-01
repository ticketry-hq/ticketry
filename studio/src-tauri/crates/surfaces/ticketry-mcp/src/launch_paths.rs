//! The read-only launch-path ingress the still-Python terminal capability asks.
//!
//! It shares the loopback listener and the per-launch credential the Runs
//! ingress already uses, and it is deliberately the *only* route that answers
//! a Documents or Worktrees question for Django. It reads: there is no verb
//! here that creates, saves, prunes, discards, or integrates anything, and the
//! request body is rejected outright if it carries a path, a Git argument, a
//! document body, or any other unexpected field.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use ticketry_launch::{LaunchPathsRequest, LaunchPathsService};

#[derive(Clone)]
pub(super) struct LaunchPathsIngressState {
    service: LaunchPathsService,
    credential: Arc<String>,
}

impl LaunchPathsIngressState {
    pub(super) fn new(database: DatabaseConnection, credential: String) -> Self {
        Self {
            service: LaunchPathsService::new(database),
            credential: Arc::new(credential),
        }
    }
}

/// Resolve one run's working directory and design directory.
///
/// A malformed body is a 400 rather than a retry-worthy 503: no amount of
/// waiting turns a smuggled path field into a launch identity.
pub(super) async fn resolve(
    State(state): State<LaunchPathsIngressState>,
    headers: HeaderMap,
    body: Result<Json<LaunchPathsRequest>, axum::extract::rejection::JsonRejection>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "launch_paths_unauthorized"})),
        );
    }
    let Ok(Json(request)) = body else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "code": "launch_paths_invalid_request"})),
        );
    };
    match state.service.resolve(request).await {
        Ok(view) => (StatusCode::OK, Json(json!({ "ok": true, "paths": view }))),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

fn authorized(state: &LaunchPathsIngressState, headers: &HeaderMap) -> bool {
    headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == state.credential.as_str())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::super::test_support::start_authorizer;
    use super::super::tests::start;

    /// What Django posts: identities and a scope, nothing else.
    fn request() -> serde_json::Value {
        json!({
            "version": 1,
            "scope": "task",
            "agent_run_id": "0f7f2b8a5d2c4c2f9d1a0b3c4d5e6f70",
            "project_id": "10000000-0000-0000-0000-000000000000",
            "task_id": "60000000-0000-0000-0000-000000000001",
        })
    }

    async fn call(url: &str, credential: Option<&str>, body: serde_json::Value) -> (u16, Value) {
        let mut request = reqwest::Client::new().post(url).json(&body);
        if let Some(credential) = credential {
            request = request.header("x-api-key", credential);
        }
        let response = request.send().await.expect("call the launch path ingress");
        let status = response.status().as_u16();
        (status, response.json().await.expect("decode the response"))
    }

    #[tokio::test]
    async fn the_ingress_answers_only_the_holder_of_the_launch_credential() {
        let directory = tempfile::tempdir().expect("create a runtime directory");
        let (backend, cancellation, task) = start_authorizer().await;
        let runtime = start(&directory, 0, backend).await;
        let url = format!(
            "http://127.0.0.1:{}/workspace/launch-paths",
            runtime.address().port()
        );

        let (anonymous, body) = call(&url, None, request()).await;
        let (wrong, _) = call(&url, Some("not-the-credential"), request()).await;

        assert_eq!(anonymous, 401);
        assert_eq!(body["code"], "launch_paths_unauthorized");
        assert_eq!(wrong, 401);

        runtime.shutdown().await;
        cancellation.cancel();
        let _ = task.await;
    }

    #[tokio::test]
    async fn a_smuggled_place_or_command_never_reaches_resolution() {
        let directory = tempfile::tempdir().expect("create a runtime directory");
        let (backend, cancellation, task) = start_authorizer().await;
        let runtime = start(&directory, 0, backend).await;
        let url = format!(
            "http://127.0.0.1:{}/workspace/launch-paths",
            runtime.address().port()
        );

        for smuggled in ["path", "cwd", "repo_root", "branch", "content"] {
            let mut body = request();
            body[smuggled] = json!("/etc");

            let (status, response) = call(&url, Some("fixture-key"), body).await;

            assert_eq!(status, 400, "the ingress accepted a `{smuggled}` field");
            assert_eq!(response["code"], "launch_paths_invalid_request");
        }

        runtime.shutdown().await;
        cancellation.cancel();
        let _ = task.await;
    }

    #[tokio::test]
    async fn a_stale_sidecar_contract_is_refused_before_anything_is_resolved() {
        let directory = tempfile::tempdir().expect("create a runtime directory");
        let (backend, cancellation, task) = start_authorizer().await;
        let runtime = start(&directory, 0, backend).await;
        let url = format!(
            "http://127.0.0.1:{}/workspace/launch-paths",
            runtime.address().port()
        );
        let mut body = request();
        body["version"] = json!(2);

        let (status, response) = call(&url, Some("fixture-key"), body).await;

        assert_eq!(status, 400);
        assert_eq!(response["code"], "launch_paths_unsupported_version");

        runtime.shutdown().await;
        cancellation.cancel();
        let _ = task.await;
    }
}
