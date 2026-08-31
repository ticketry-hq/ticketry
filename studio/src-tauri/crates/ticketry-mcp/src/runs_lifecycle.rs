//! Authenticated loopback ingress for provider lifecycle facts.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use ticketry_runs::persistence::{LifecycleFact, RunsServices};

#[derive(Clone)]
pub(super) struct RunsIngressState {
    services: RunsServices,
    authority: super::RunAuthority,
}

impl RunsIngressState {
    pub(super) fn new(
        database: sea_orm::DatabaseConnection,
        authority: super::RunAuthority,
    ) -> Self {
        Self {
            services: RunsServices::new(database),
            authority,
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
    let authorization = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok());
    if let Err(failure) = state
        .authority
        .authorize_run(authorization, &body.agent_run_id)
        .await
    {
        return (StatusCode::UNAUTHORIZED, Json(failure.0));
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
