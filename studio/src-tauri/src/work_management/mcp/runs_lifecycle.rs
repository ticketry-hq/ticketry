//! Authenticated loopback ingress for provider lifecycle facts.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runs_persistence::{LifecycleFact, RunsServices};

#[derive(Clone)]
pub(super) struct RunsIngressState {
    services: RunsServices,
    credential: Arc<String>,
}

impl RunsIngressState {
    pub(super) fn new(
        database: DatabaseConnection,
        _backend_base_url: String,
        credential: String,
    ) -> Self {
        Self {
            services: RunsServices::new(database),
            credential: Arc::new(credential),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct LifecycleIngress {
    agent_run_id: String,
    kind: String,
    occurred_at: String,
    #[serde(default)]
    provider_session_id: Option<String>,
}

pub(super) async fn ingest(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<LifecycleIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "lifecycle_ingress_unauthorized"})),
        );
    }
    match state
        .services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: body.agent_run_id,
            kind: body.kind,
            occurred_at: body.occurred_at,
            provider_session_id: body.provider_session_id,
        })
        .await
    {
        Ok(acceptance) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "accepted": acceptance.accepted,
                "known_run": acceptance.known_run,
                "applied": acceptance.applied,
                "state": acceptance.state,
                "occurred_at": acceptance.occurred_at,
                "event_cursor": acceptance.event_cursor,
            })),
        ),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

fn authorized(state: &RunsIngressState, headers: &HeaderMap) -> bool {
    headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == state.credential.as_str())
}
