//! Bind the MCP transport's authenticated run to the authoritative Rust
//! termination service.
//!
//! The temporary Python terminal boundary is demoted to an executor: it runs
//! only after Rust has authorized the authenticated current run, and Rust —
//! not Django — records the durable terminal outcome.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use crate::runs_persistence::{
    AuthenticatedAgentRun, McpRunControl, RunTerminationService, RunsPersistenceError,
    RunsPersistenceErrorCode, RunsServices, TerminateRunRequest, TerminationExecutor,
    TerminationExecutorEvidence,
};

use super::backend_port::{BackendPort, RunPrincipal};

/// The bounded payload crossing into the Python terminal boundary is the
/// Studio-issued request authorization that already names the run. No prompt,
/// path, secret, environment, or command line is forwarded.
struct TerminalBoundaryExecutor {
    backend: BackendPort,
    authorization: String,
}

#[async_trait]
impl TerminationExecutor for TerminalBoundaryExecutor {
    async fn terminate(
        &self,
        _request: TerminateRunRequest,
    ) -> Result<TerminationExecutorEvidence, RunsPersistenceError> {
        let response = self.backend.terminate(&self.authorization).await;
        if response.get("error").is_some()
            || response.get("terminated").and_then(Value::as_bool) != Some(true)
        {
            return Err(RunsPersistenceError::executor_unavailable(
                "The terminal compatibility executor did not terminate the current run.",
            ));
        }
        Ok(TerminationExecutorEvidence {
            was_present: response.get("already_terminated").and_then(Value::as_bool) != Some(true),
        })
    }
}

/// Terminate only the run named by the authenticated MCP principal. The tool
/// accepts no target argument, so no caller can widen the blast radius.
pub async fn terminate_current_run(
    database: &DatabaseConnection,
    backend: &BackendPort,
    principal: &RunPrincipal,
    authorization: &str,
) -> Value {
    let control = McpRunControl::new(RunTerminationService::new(
        database.clone(),
        RunsServices::new(database.clone()).lifecycle().clone(),
        Arc::new(TerminalBoundaryExecutor {
            backend: backend.clone(),
            authorization: authorization.to_owned(),
        }),
    ));
    match control
        .terminate_current_run(&AuthenticatedAgentRun {
            agent_run_id: principal.agent_run_id.clone(),
            issue_id: principal.issue_id.clone(),
            project_id: principal.project_id.clone(),
            scope: principal.scope.clone(),
        })
        .await
    {
        Ok(result) => json!({
            "ok": true,
            "terminated": result.terminated,
            "already_terminated": result.already_terminated,
            "agent_run_id": result.agent_run_id,
        }),
        Err(error) => json!({"ok": false, "error": compatibility_code(&error)}),
    }
}

/// Preserve the established run-control error vocabulary so historical agents
/// keep reading the same codes after Rust took authority.
fn compatibility_code(error: &RunsPersistenceError) -> &'static str {
    match error.code() {
        RunsPersistenceErrorCode::NotFound => "caller_run_unknown",
        RunsPersistenceErrorCode::Unauthorized => "caller_run_unbound",
        RunsPersistenceErrorCode::ExecutorUnavailable => "terminate_failed",
        _ => error.code_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn termination_errors_keep_the_established_run_control_codes() {
        assert_eq!(
            compatibility_code(&RunsPersistenceError::not_found("missing")),
            "caller_run_unknown"
        );
        assert_eq!(
            compatibility_code(&RunsPersistenceError::unauthorized("mismatched")),
            "caller_run_unbound"
        );
        assert_eq!(
            compatibility_code(&RunsPersistenceError::executor_unavailable("down")),
            "terminate_failed"
        );
    }
}
