//! The run-authorization port the composed runtime calls.
//!
//! In production this is the Python boundary: the MCP listener asks it which
//! Agent Run is calling, and an interactive launch asks it for the run-scoped
//! credential it embeds in the runtime. Neither belongs to this slice, so the
//! harness answers both locally and lets a test decide which principal is
//! calling.
#![allow(dead_code)]

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::execution_django_fixture as fixture;
use super::execution_harness::public_id;

pub(super) const AUTHORIZATION_CREDENTIAL: &str = "slice6-harness-credential";

pub struct Authorization {
    principal: Arc<Mutex<Value>>,
    address: Arc<Mutex<Option<SocketAddr>>>,
    cancellation: Mutex<Option<CancellationToken>>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for Authorization {
    fn default() -> Self {
        Self {
            principal: Arc::new(Mutex::new(principal(
                fixture::CAMPAIGN_PROJECT,
                fixture::PARALLEL_CAMPAIGN_ROOT,
            ))),
            address: Arc::new(Mutex::new(None)),
            cancellation: Mutex::new(None),
            task: Mutex::new(None),
        }
    }
}

impl Authorization {
    /// Bind the caller to another project, so a cross-project request is
    /// observed being refused by the composed scope rules.
    pub fn bind_to_project(&self, project_id: &str, issue_id: &str) {
        *self.principal.lock().expect("principal lock") = principal(project_id, issue_id);
    }

    pub(super) fn base_url(&self) -> String {
        let address = self
            .address
            .lock()
            .expect("authorization address lock")
            .expect("authorization port is listening");
        format!("http://{address}/api")
    }

    pub(super) async fn start(&self) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the authorization port");
        *self.address.lock().expect("authorization address lock") =
            Some(listener.local_addr().expect("authorization address"));
        let cancellation = CancellationToken::new();
        let shutdown = cancellation.clone();
        let router = axum::Router::new()
            .route(
                "/api/runs/mcp-authorize",
                axum::routing::post(authorize_caller),
            )
            .route(
                "/api/runs/authorization",
                axum::routing::post(issue_run_credential),
            )
            .with_state(Arc::clone(&self.principal));
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
                .await;
        });
        *self.cancellation.lock().expect("authorization lock") = Some(cancellation);
        *self.task.lock().expect("authorization task lock") = Some(task);
    }

    pub(super) async fn stop(&self) {
        let cancellation = self.cancellation.lock().expect("authorization lock").take();
        let task = self.task.lock().expect("authorization task lock").take();
        if let Some(cancellation) = cancellation {
            cancellation.cancel();
        }
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}

async fn authorize_caller(State(principal): State<Arc<Mutex<Value>>>) -> Json<Value> {
    Json(principal.lock().expect("principal lock").clone())
}

/// The run-scoped credential an interactive launch embeds in its runtime. Its
/// value never reaches a result, so the harness can mint a constant.
async fn issue_run_credential() -> Json<Value> {
    Json(json!({"authorization": "Bearer slice6-run"}))
}

/// The run principal the authorization port reports, in the hyphenated form
/// the Python boundary returns and the read projections compare against.
fn principal(project_id: &str, issue_id: &str) -> Value {
    json!({
        "agent_run_id": "slice6-caller",
        "issue_id": public_id(issue_id),
        "project_id": public_id(project_id),
        "scope": "task",
    })
}
