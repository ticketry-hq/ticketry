use async_trait::async_trait;
use sea_orm::DatabaseConnection;

use crate::terminal::launch::TerminalLaunchService;
use crate::work_management::launch_policy::{self, LaunchPolicyDecision};

use super::{error::MergePreparationError, types::LaunchedAgent};

#[async_trait]
pub(super) trait MergePreparationLauncher: Send + Sync {
    async fn launch(
        &self,
        decision: &LaunchPolicyDecision,
    ) -> Result<LaunchedAgent, MergePreparationError>;
}

pub(super) struct TerminalMergePreparationLauncher {
    database: DatabaseConnection,
    terminals: TerminalLaunchService,
}

impl TerminalMergePreparationLauncher {
    pub(super) fn new(database: DatabaseConnection, terminals: TerminalLaunchService) -> Self {
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
        let session =
            launch_policy::execute_pending_decision(&self.database, &self.terminals, &decision)
                .await
                .map_err(MergePreparationError::launch_failed)?;
        Ok(LaunchedAgent {
            agent: session.agent.unwrap_or(decision.provider),
            agent_run_id: session.agent_run_id,
        })
    }
}
