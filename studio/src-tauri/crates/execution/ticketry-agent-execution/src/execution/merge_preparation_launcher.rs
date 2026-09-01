//! The terminal-backed adapter for worktree merge preparation.
//!
//! Worktree owns the decision and the port; starting the agent is agent
//! execution's job, which is where the Terminal Launch Service lives.

use async_trait::async_trait;
use sea_orm::DatabaseConnection;

use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::launch_policy::{self, LaunchPolicyDecision};
use ticketry_workspace_runtime::changes::{
    LaunchedAgent, MergePreparationError, MergePreparationLauncher,
};

pub struct TerminalMergePreparationLauncher {
    database: DatabaseConnection,
    terminals: TerminalLaunchService,
}

impl TerminalMergePreparationLauncher {
    pub fn new(database: DatabaseConnection, terminals: TerminalLaunchService) -> Self {
        Self {
            database,
            terminals,
        }
    }
}

#[async_trait]
impl MergePreparationLauncher for TerminalMergePreparationLauncher {
    async fn launch(
        &self,
        decision: &LaunchPolicyDecision,
    ) -> Result<LaunchedAgent, MergePreparationError> {
        let decision = launch_policy::record(&self.database, decision).await?;
        let session = super::launch_delivery::execute(&self.database, &self.terminals, &decision)
            .await
            .map_err(MergePreparationError::launch_failed)?;
        Ok(LaunchedAgent {
            agent: session.agent.unwrap_or(decision.provider),
            agent_run_id: session.agent_run_id,
        })
    }
}
