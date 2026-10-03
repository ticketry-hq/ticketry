use std::{path::Path, sync::Arc, time::Duration};

use ticketry_agent_execution::reconciliation::{
    ExecutionReconciliationConfig, ExecutionReconciliationRuntime, ExecutionReconciliationService,
};
use ticketry_graphql_schema::ComposedCommandRuntime;
use ticketry_runs::{HookSpool, HookSpoolRuntime, RunsServices};
use ticketry_terminal::{
    ProductionTerminalLifecycleWork, TerminalLaunchService, TerminalLifecycleConfig,
    TerminalLifecycleRuntime, TerminalReconciliationService, TmuxCleanupRuntime,
};

pub(super) struct RecoveryRuntimes {
    execution: ExecutionReconciliationRuntime,
    hooks: HookSpoolRuntime,
    terminal: Arc<TerminalLifecycleRuntime>,
}

impl RecoveryRuntimes {
    pub(super) async fn start(
        composed: &ComposedCommandRuntime,
        data_directory: &Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let database = composed.commands().clone();
        let spool = HookSpool::new(
            ticketry_runs::ensure_hook_spool_directory(data_directory)?,
            RunsServices::new(database.clone()).lifecycle().clone(),
            ticketry_runs::DEFAULT_BATCH_SIZE,
        )?;
        let terminal = Arc::new(
            TerminalLifecycleRuntime::start(
                Arc::new(ProductionTerminalLifecycleWork::new(
                    database.clone(),
                    spool.clone(),
                    TerminalReconciliationService::new(
                        database.clone(),
                        Arc::new(composed.terminal_runtime().clone()),
                        Arc::new(TmuxCleanupRuntime::default()),
                    ),
                    composed.viewer_ownership().clone(),
                )),
                TerminalLifecycleConfig::default(),
            )
            .await?,
        );
        let execution = match ExecutionReconciliationRuntime::start(
            ExecutionReconciliationService::new(
                database.clone(),
                ticketry_work_management::launch_policy::LaunchPolicyResolver::new(
                    database.clone(),
                ),
                TerminalLaunchService::new(
                    database.clone(),
                    Arc::new(composed.terminal_runtime().clone()),
                )
                .with_authority(Arc::new(
                    ticketry_launch::LaunchAuthorityService::new(database),
                )),
            ),
            Arc::clone(&terminal),
            ExecutionReconciliationConfig::default(),
        )
        .await
        {
            Ok(execution) => execution,
            Err(error) => {
                stop_terminal(&terminal).await;
                return Err(error.into());
            }
        };
        let hooks = match spool.start(Duration::from_secs(1)).await {
            Ok((_, hooks)) => hooks,
            Err(error) => {
                execution.shutdown().await;
                stop_terminal(&terminal).await;
                return Err(error.into());
            }
        };
        Ok(Self {
            execution,
            hooks,
            terminal,
        })
    }

    pub(super) async fn shutdown(self) {
        self.execution.shutdown().await;
        self.hooks.shutdown().await;
        stop_terminal(&self.terminal).await;
    }
}

async fn stop_terminal(terminal: &TerminalLifecycleRuntime) {
    if let Err(error) = terminal.shutdown().await {
        eprintln!("Ticketry browser terminal recovery shutdown failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ticketry_agent_execution::{graph::GraphAccess, GraphRunRequest, GraphRunService};

    #[tokio::test]
    async fn browser_recovery_opens_graph_run_mutations_and_closes_them_on_shutdown() {
        let directory = tempfile::tempdir().unwrap();
        let previous_socket = std::env::var_os("MUXED_TMUX_SOCKET");
        std::env::set_var(
            "MUXED_TMUX_SOCKET",
            format!("ticketry-recovery-test-{}", uuid::Uuid::new_v4().simple()),
        );
        ticketry_installation::provision(directory.path())
            .await
            .unwrap();
        let api = tauri_graphql::TransportApiImpl::new();
        let adopted = ticketry_graphql_schema::adopt_worktracker_and_install(
            &directory.path().join("rust-core.sqlite3"),
            directory.path(),
            &api,
            ticketry_graphql_schema::InstallationOwnership::Owned,
        )
        .await
        .unwrap();
        let database = adopted.runtime.commands().clone();
        let service = GraphRunService::production(
            database.clone(),
            ticketry_work_management::launch_policy::LaunchPolicyResolver::new(database.clone()),
            TerminalLaunchService::new(
                database,
                Arc::new(adopted.runtime.terminal_runtime().clone()),
            ),
        );
        let request = GraphRunRequest {
            root_id: "missing-root".into(),
            access: GraphAccess::project("missing-project"),
            mode: None,
            provider_override: None,
        };
        assert_eq!(
            service
                .create(request.clone())
                .await
                .unwrap_err()
                .code_str(),
            "execution_reconciliation_unavailable"
        );
        let recovery = RecoveryRuntimes::start(&adopted.runtime, directory.path())
            .await
            .unwrap();
        assert_eq!(
            service
                .create(request.clone())
                .await
                .unwrap_err()
                .code_str(),
            "task_not_found"
        );
        recovery.shutdown().await;
        assert_eq!(
            service.create(request).await.unwrap_err().code_str(),
            "execution_reconciliation_unavailable"
        );
        match previous_socket {
            Some(socket) => std::env::set_var("MUXED_TMUX_SOCKET", socket),
            None => std::env::remove_var("MUXED_TMUX_SOCKET"),
        }
    }
}
