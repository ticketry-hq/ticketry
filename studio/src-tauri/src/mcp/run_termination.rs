use sea_orm::EntityTrait;
use serde_json::{json, Value};

use crate::entities::terminals::session;
use crate::terminal::cleanup::{
    AuthenticatedAgentRun, TerminalCleanupError, TerminalCleanupErrorCode, TerminalCleanupService,
};

use super::RunPrincipal;

const RESPONSE_GRACE: std::time::Duration = std::time::Duration::from_millis(250);

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
    let authenticated = AuthenticatedAgentRun {
        agent_run_id: principal.agent_run_id.clone(),
        issue_id: principal.issue_id.clone(),
        project_id: principal.project_id.clone(),
        scope: principal.scope.clone(),
    };
    let request_id = format!("mcp-self:{}", principal.agent_run_id);
    match service
        .request_current_run_termination(&authenticated, &request_id)
        .await
    {
        Ok(terminal) => {
            if !already_terminated {
                let service = service.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(RESPONSE_GRACE).await;
                    if let Err(error) = service
                        .terminate_current_run(&authenticated, &request_id)
                        .await
                    {
                        eprintln!(
                            "Ticketry could not complete requested self-termination for {}: {}",
                            authenticated.agent_run_id, error
                        );
                    }
                });
            }
            json!({
                "ok": true,
                "termination_requested": true,
                "terminated": terminal.terminated_at.is_some(),
                "already_terminated": already_terminated,
                "agent_run_id": terminal.agent_run_id,
            })
        }
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
