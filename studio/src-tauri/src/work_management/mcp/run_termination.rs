use sea_orm::EntityTrait;
use serde_json::{json, Value};

use crate::entities::terminals::session;
use crate::terminal_cleanup::{
    AuthenticatedAgentRun, TerminalCleanupError, TerminalCleanupErrorCode, TerminalCleanupService,
};

use super::backend_port::RunPrincipal;

/// Terminate only the run named by the authenticated MCP principal. The tool
/// accepts no target argument, so no caller can widen the blast radius.
pub async fn terminate_current_run(
    service: &TerminalCleanupService,
    principal: &RunPrincipal,
) -> Value {
    let already_terminated = session::Entity::find_by_id(&principal.agent_run_id)
        .one(service.database())
        .await
        .ok()
        .flatten()
        .is_some_and(|terminal| terminal.terminated_at.is_some());
    match service
        .terminate_current_run(
            &AuthenticatedAgentRun {
                agent_run_id: principal.agent_run_id.clone(),
                issue_id: principal.issue_id.clone(),
                project_id: principal.project_id.clone(),
                scope: principal.scope.clone(),
            },
            &format!("mcp-self:{}", principal.agent_run_id),
        )
        .await
    {
        Ok(terminal) => json!({
            "ok": true,
            "terminated": terminal.terminated_at.is_some(),
            "already_terminated": already_terminated,
            "agent_run_id": terminal.agent_run_id,
        }),
        Err(error) => json!({"ok": false, "error": compatibility_code(&error)}),
    }
}

/// Preserve the established run-control error vocabulary so historical agents
/// keep reading the same codes after Rust took authority.
fn compatibility_code(error: &TerminalCleanupError) -> &'static str {
    match error.code() {
        TerminalCleanupErrorCode::NotFound => "caller_run_unknown",
        TerminalCleanupErrorCode::InvalidRequest => "caller_run_unbound",
        TerminalCleanupErrorCode::CleanupPending | TerminalCleanupErrorCode::RuntimeUnavailable => {
            "terminate_failed"
        }
        _ => error.code_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn termination_errors_keep_the_established_run_control_codes() {
        assert_eq!(
            compatibility_code(&TerminalCleanupError::new(
                TerminalCleanupErrorCode::NotFound,
                "missing"
            )),
            "caller_run_unknown"
        );
        assert_eq!(
            compatibility_code(&TerminalCleanupError::new(
                TerminalCleanupErrorCode::InvalidRequest,
                "mismatched"
            )),
            "caller_run_unbound"
        );
        assert_eq!(
            compatibility_code(&TerminalCleanupError::new(
                TerminalCleanupErrorCode::CleanupPending,
                "down"
            )),
            "terminate_failed"
        );
    }
}
