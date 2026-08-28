use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::terminal::launch::{CreateTerminalSession, TerminalLaunchKind, TerminalLaunchService};

#[derive(Clone)]
pub(super) struct TerminalLaunchIngressState {
    service: TerminalLaunchService,
    credential: Arc<String>,
}

impl TerminalLaunchIngressState {
    pub(super) fn new(service: TerminalLaunchService, credential: String) -> Self {
        Self {
            service,
            credential: Arc::new(credential),
        }
    }
}

#[derive(Deserialize)]
pub(super) struct LaunchBody {
    client_request_id: String,
    project_id: String,
    issue_id: String,
    module_id: String,
    target_id: String,
    kind: String,
    provider: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
    #[serde(default)]
    policy_reference: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    automation_attempt_id: Option<String>,
    #[serde(default)]
    required_skills: Vec<String>,
    working_directory_identity: String,
}

pub(super) async fn launch(
    State(state): State<TerminalLaunchIngressState>,
    headers: HeaderMap,
    Json(body): Json<LaunchBody>,
) -> (StatusCode, Json<Value>) {
    if headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        != Some(state.credential.as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "code": "terminal_launch_unauthorized"})),
        );
    }
    let kind = match TerminalLaunchKind::parse(&body.kind) {
        Ok(kind) => kind,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "code": error.code_str()})),
            )
        }
    };
    match state
        .service
        .create(CreateTerminalSession {
            client_request_id: body.client_request_id,
            project_id: body.project_id,
            issue_id: body.issue_id,
            module_id: body.module_id,
            target_id: body.target_id,
            kind,
            provider: Some(body.provider),
            model: body.model,
            reasoning: body.reasoning,
            policy_reference: body.policy_reference,
            prompt: body.prompt,
            resume_from_agent_run_id: None,
            automation_attempt_id: body.automation_attempt_id,
            required_skills: body.required_skills,
            working_directory_identity: body.working_directory_identity,
            design_directory_identity: None,
            document_relative_path: None,
            columns: 120,
            rows: 32,
        })
        .await
    {
        Ok(session) => (
            StatusCode::OK,
            Json(json!({"ok": true, "agent_run_id": session.agent_run_id})),
        ),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "code": error.code_str(), "detail": error.to_string()})),
        ),
    }
}
