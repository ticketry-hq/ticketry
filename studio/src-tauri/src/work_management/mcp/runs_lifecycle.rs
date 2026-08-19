//! The loopback ingress the still-Python lifecycle adapter delegates to.
//!
//! Provider hooks stay outside the WebView trust boundary, so Django keeps the
//! normalized loopback/spool adapter it already has. What changed at the Slice
//! 3 handoff is who owns the fact: Django no longer writes an Agent Run row, it
//! forwards the normalized fact here and acknowledges its own caller only after
//! this route reports that Rust committed. A duplicate or older fact is a
//! no-op, so spool replay and HTTP retry are harmless by construction.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runs_effect_port::RunsEffectPort;
use crate::runs_persistence::{
    AttemptOutcome, LaunchIntent, LaunchOutcome, LifecycleFact, PrepareLaunchRequest, RunSnapshot,
    RunsServices, TerminalFact, TerminalOutcome, TransitionOccurrence,
};

#[derive(Clone)]
pub(super) struct RunsIngressState {
    services: RunsServices,
    effect_port: RunsEffectPort,
    credential: Arc<String>,
}

impl RunsIngressState {
    pub(super) fn new(
        database: DatabaseConnection,
        backend_base_url: String,
        credential: String,
    ) -> Self {
        Self {
            services: RunsServices::new(database),
            effect_port: RunsEffectPort::new(backend_base_url, credential.clone()),
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

/// Apply one normalized lifecycle fact. The response is the acknowledgement
/// contract: Django may acknowledge its own caller only for a 200.
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
                // An unknown historical run keeps its established
                // accepted/no-op meaning, and appends no durable event.
                "accepted": acceptance.accepted,
                "known_run": acceptance.known_run,
                "applied": acceptance.applied,
                "state": acceptance.state,
                "occurred_at": acceptance.occurred_at,
                "event_cursor": acceptance.event_cursor,
            })),
        ),
        // A refusal must not be acknowledged: the adapter retries, and its
        // spool file survives. The code names no database, path, or command.
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

/// The complete input to one Django-initiated launch. Identities are minted by
/// the caller so a transport retry is idempotent, and the body is validated as
/// an immutable launch intent — it has no command, path, or credential field.
#[derive(Debug, Deserialize)]
pub(super) struct LaunchIngress {
    intent: Value,
    #[serde(default)]
    snapshot: RunSnapshotIngress,
}

/// The run snapshot fields the Agent Run has always carried. None of them is
/// reconcilable intent, and none is a command, credential, or environment.
#[derive(Debug, Default, Deserialize)]
pub(super) struct RunSnapshotIngress {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    design_dir: Option<String>,
    #[serde(default)]
    resumed_from: Option<String>,
    #[serde(default)]
    provider_session_id: Option<String>,
}

impl From<RunSnapshotIngress> for RunSnapshot {
    fn from(value: RunSnapshotIngress) -> Self {
        Self {
            model: value.model,
            reasoning: value.reasoning,
            cwd: value.cwd,
            design_dir: value.design_dir,
            resumed_from: value.resumed_from,
            provider_session_id: value.provider_session_id,
        }
    }
}

/// Prepare and perform one launch: durable fact first, external effect second,
/// durable outcome third. The external effect is the temporary Python terminal
/// executor, reached back through the effect port; it never writes a Runs row.
pub(super) async fn launch(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<LaunchIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "launch_ingress_unauthorized"})),
        );
    }
    let intent = match LaunchIntent::from_json(&body.intent) {
        Ok(intent) => intent,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "code": error.code_str()})),
            )
        }
    };
    let dispatch = state
        .services
        .effects()
        .dispatch_with(Arc::new(state.effect_port.clone()));
    match dispatch
        .launch(PrepareLaunchRequest {
            intent,
            snapshot: body.snapshot.into(),
        })
        .await
    {
        Ok(recorded) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "effect_id": recorded.effect.effect_id,
                "agent_run_id": recorded.effect.agent_run_id,
                "state": recorded.effect.state,
                "settled": recorded.settled,
                "last_error_code": recorded.effect.last_error_code,
            })),
        ),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

/// One durable terminal outcome observed by the temporary terminal
/// capability: a session that exited, was lost, or was explicitly terminated.
#[derive(Debug, Deserialize)]
pub(super) struct TerminalIngress {
    agent_run_id: String,
    outcome: String,
    occurred_at: String,
    #[serde(default)]
    exit_code: Option<i32>,
}

/// Record an explicit terminal outcome. It is terminal authority: a later
/// provider lifecycle hook cannot regress it, and neither can a Django
/// "recovery" that observes the runtime alive again.
pub(super) async fn terminal_outcome(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<TerminalIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "terminal_ingress_unauthorized"})),
        );
    }
    let outcome = match body.outcome.as_str() {
        "exited" => TerminalOutcome::Exited,
        "lost" => TerminalOutcome::Lost,
        "terminated" => TerminalOutcome::Terminated,
        "failed" => TerminalOutcome::Failed,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "code": "terminal_outcome_invalid"})),
            )
        }
    };
    match state
        .services
        .lifecycle()
        .apply_terminal_fact(TerminalFact {
            agent_run_id: body.agent_run_id,
            outcome,
            occurred_at: body.occurred_at,
            exit_code: body.exit_code,
        })
        .await
    {
        Ok(acceptance) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
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

/// Prepare one launch durably without performing it. The temporary terminal
/// capability drives its own effect: it prepares here, creates the runtime, and
/// settles below. Rust still owns every row, and a rolled-back preparation
/// leaves nothing an executor could act on.
pub(super) async fn prepare_launch(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<LaunchIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "launch_ingress_unauthorized"})),
        );
    }
    let intent = match LaunchIntent::from_json(&body.intent) {
        Ok(intent) => intent,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "code": error.code_str()})),
            )
        }
    };
    match state
        .services
        .effects()
        .prepare_launch(PrepareLaunchRequest {
            intent,
            snapshot: body.snapshot.into(),
        })
        .await
    {
        Ok(prepared) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "effect_id": prepared.effect.effect_id,
                "agent_run_id": prepared.effect.agent_run_id,
                "state": prepared.effect.state,
                // A repeated transport request finds its own effect rather
                // than minting a second run, so a retry is safe.
                "reused": prepared.reused,
            })),
        ),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

/// Settle one prepared effect with the outcome its executor observed. The
/// claim is taken here, so no lease owner ever crosses the boundary and a
/// Python caller cannot settle an effect another worker holds.
#[derive(Debug, Deserialize)]
pub(super) struct SettleIngress {
    effect_id: String,
    applied: bool,
    #[serde(default)]
    runtime_id: Option<String>,
    #[serde(default)]
    adopted: bool,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    retryable: bool,
    #[serde(default)]
    cleanup_confirmed: bool,
}

pub(super) async fn settle_launch(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<SettleIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "launch_ingress_unauthorized"})),
        );
    }
    let effects = state.services.effects();
    let dispatch = effects.dispatch_with(Arc::new(state.effect_port.clone()));
    let lease_owner = dispatch.lease_owner().to_owned();
    if let Err(error) = effects.claim(&body.effect_id, &lease_owner, 120).await {
        return (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "code": error.code_str()})),
        );
    }
    let outcome = if body.applied {
        let Some(runtime_id) = body.runtime_id.filter(|value| !value.is_empty()) else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "code": "launch_runtime_evidence_missing"})),
            );
        };
        LaunchOutcome::Applied {
            runtime_evidence: json!({"runtimeId": runtime_id, "adopted": body.adopted}),
        }
    } else {
        LaunchOutcome::Failed {
            code: body.code.unwrap_or_else(|| "launch_failed".to_owned()),
            message: body
                .message
                .unwrap_or_else(|| "The launch effect could not be performed.".to_owned()),
            retryable: body.retryable,
            cleanup_confirmed: body.cleanup_confirmed,
        }
    };
    match effects
        .record_outcome(&body.effect_id, &lease_owner, outcome)
        .await
    {
        Ok(recorded) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "state": recorded.effect.state,
                "settled": recorded.settled,
                "attempt_status": recorded.attempt.map(|attempt| attempt.status),
            })),
        ),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

/// Materialize the pending root Automation Attempt for one committed
/// transition occurrence. Re-delivery returns the same row.
#[derive(Debug, Deserialize)]
pub(super) struct OccurrenceIngress {
    occurrence_id: String,
    issue_id: String,
    project_id: String,
    from_state_id: String,
    to_state_id: String,
    workflow_revision: i32,
}

pub(super) async fn materialize_attempt(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<OccurrenceIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "attempt_ingress_unauthorized"})),
        );
    }
    match state
        .services
        .attempts()
        .materialize_root(&TransitionOccurrence {
            occurrence_id: body.occurrence_id,
            issue_id: body.issue_id,
            project_id: body.project_id,
            from_state_id: body.from_state_id,
            to_state_id: body.to_state_id,
            workflow_revision: body.workflow_revision,
        })
        .await
    {
        Ok(attempt) => (StatusCode::OK, Json(attempt_body(attempt))),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

/// Record one Automation Attempt's terminal outcome.
#[derive(Debug, Deserialize)]
pub(super) struct AttemptOutcomeIngress {
    attempt_id: String,
    succeeded: bool,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    agent_run_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    failure: Option<Value>,
    #[serde(default)]
    retryable: bool,
}

pub(super) async fn record_attempt_outcome(
    State(state): State<RunsIngressState>,
    headers: HeaderMap,
    Json(body): Json<AttemptOutcomeIngress>,
) -> (StatusCode, Json<Value>) {
    if !authorized(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "attempt_ingress_unauthorized"})),
        );
    }
    let outcome = if body.succeeded {
        match (body.agent, body.agent_run_id) {
            (Some(agent), Some(agent_run_id)) => AttemptOutcome::Succeeded {
                agent,
                agent_run_id,
            },
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"ok": false, "code": "attempt_success_identity_missing"})),
                )
            }
        }
    } else {
        AttemptOutcome::Failed {
            error: body.error.unwrap_or_else(|| "launch_failed".to_owned()),
            failure: body.failure.unwrap_or(Value::Null),
            retryable: body.retryable,
        }
    };
    match state
        .services
        .attempts()
        .record_outcome(&body.attempt_id, outcome)
        .await
    {
        Ok(attempt) => (StatusCode::OK, Json(attempt_body(attempt))),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"ok": false, "code": error.code_str()})),
        ),
    }
}

fn attempt_body(attempt: crate::runs_persistence::AutomationAttemptProjection) -> Value {
    json!({
        "ok": true,
        "attempt_id": attempt.attempt_id,
        "root_attempt_id": attempt.root_attempt_id,
        "work_item_id": attempt.work_item_id,
        "status": attempt.status,
        "retry_of_attempt_id": attempt.retry_of_attempt_id,
        "agent_run_id": attempt.agent_run_id,
        "error": attempt.error,
        "retryable": attempt.retryable,
        "updated_at": attempt.updated_at,
    })
}
