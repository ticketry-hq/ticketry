use async_trait::async_trait;
use sea_orm::DatabaseConnection;

use crate::terminal_launch::TerminalLaunchService;
use crate::work_management::launch_policy::{self, LaunchPolicyDecision};

use super::RunNowRun;

#[async_trait]
pub trait RunNowLauncher: Send + Sync {
    async fn launch(&self, decision: &LaunchPolicyDecision) -> Result<RunNowRun, String>;
}

pub(crate) struct TerminalRunNowLauncher {
    database: DatabaseConnection,
    terminals: TerminalLaunchService,
}

impl TerminalRunNowLauncher {
    pub(crate) fn new(database: DatabaseConnection, terminals: TerminalLaunchService) -> Self {
        Self {
            database,
            terminals,
        }
    }
}

#[async_trait]
impl RunNowLauncher for TerminalRunNowLauncher {
    async fn launch(&self, decision: &LaunchPolicyDecision) -> Result<RunNowRun, String> {
        let session =
            launch_policy::execute_pending_decision(&self.database, &self.terminals, decision)
                .await?;
        Ok(RunNowRun {
            target_id: decision.task_id.clone(),
            agent: session.agent.unwrap_or_else(|| decision.provider.clone()),
            agent_run_id: session.agent_run_id,
        })
    }
}
