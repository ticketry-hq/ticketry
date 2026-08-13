use super::{
    AuthenticatedAgentRun, RunTerminationService, RunsPersistenceError, TerminationResult,
};

/// Thin MCP-facing adapter. Authentication is resolved by the transport and
/// the adapter exposes no caller-supplied target identifier.
#[derive(Clone)]
pub struct McpRunControl {
    termination: RunTerminationService,
}

impl McpRunControl {
    pub fn new(termination: RunTerminationService) -> Self {
        Self { termination }
    }

    pub async fn terminate_current_run(
        &self,
        principal: &AuthenticatedAgentRun,
    ) -> Result<TerminationResult, RunsPersistenceError> {
        self.termination.terminate_current_run(principal).await
    }
}
