//! Process-local startup after the no-sidecar cutover.

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::desktop::data_directory::DesktopDataDirectoryOwnership;
use crate::desktop::environment::automated_startup_exit_requested;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::mcp_runtime::start_in_process_mcp;
use crate::desktop::packaged_binaries::hook_runner_binary;
use crate::desktop::runtime_configuration::rust_runtime_configuration;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::startup_trace::DesktopStartupTrace;
use crate::desktop::{runs_handoff, workspace_handoff};
use ticketry_data_directory::established_data_directory;
use ticketry_graphql_schema::ComposedCommandRuntime;
use ticketry_terminal::{
    ProductionTerminalLifecycleWork, TerminalLifecycleConfig, TerminalLifecycleRuntime,
};

pub fn launch_rust_runtime(
    application: &tauri::AppHandle,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), String> {
    let startup_trace = application.state::<DesktopStartupTrace>();
    let state = application.state::<DesktopServiceState>();
    state.publish(application, ServiceHealth::starting());
    state.publish(application, ServiceHealth::migrating());

    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let hook_runner = hook_runner_binary(application)?;
    let launch_runtime = application.state::<DesktopLaunchRuntime>();
    let composed = launch_runtime.composed_runtime()?.clone();
    let database = composed.commands().clone();
    let spool_directory = ticketry_runs::ensure_hook_spool_directory(&data_directory)?;

    let terminal_launch = ticketry_terminal::TerminalLaunchService::new(
        database.clone(),
        Arc::new(composed.terminal_runtime().clone()),
    )
    .with_authority(Arc::new(ticketry_launch::LaunchAuthorityService::new(
        database.clone(),
    )));
    launch_runtime.configure_terminal_authority(ticketry_terminal::TerminalRuntimeAuthority {
        database: database.clone(),
        paths: ticketry_launch::LaunchPathsService::new(database.clone()),
        hook_runner,
        hook_spool_directory: spool_directory.clone(),
        mcp_data_directory: None,
        run_authority: ticketry_runs::RunAuthority::new(database.clone()),
        granted_operations: ticketry_mcp::allowed_provider_operations(),
    })?;

    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let mut mcp_runtime = {
        let guard = ownership
            .guard
            .lock()
            .expect("data-directory lock poisoned");
        let started = match guard.as_ref() {
            Some(guard) => tauri::async_runtime::block_on(start_in_process_mcp(
                &data_directory,
                guard,
                Some(terminal_launch.clone()),
            )),
            None => Err(ticketry_mcp::McpStartupError::Other {
                diagnostic: "this process does not own the data directory".to_owned(),
            }),
        };
        match started {
            Ok(runtime) => Some(runtime),
            Err(diagnostic) => {
                eprintln!(
                    "Ticketry could not start its WorkTracker MCP listener; provider launches remain blocked: {diagnostic}"
                );
                state.retain_notice(crate::desktop::user_notices::mcp_unavailable());
                None
            }
        }
    };
    startup_trace.record("mcp-listener-started");
    if let Some(runtime) = mcp_runtime.as_ref() {
        startup_trace.record("terminal-mcp-authority-replacement-started");
        launch_runtime
            .replace_terminal_mcp_authority(data_directory.clone(), runtime.authority())?;
        startup_trace.record("terminal-mcp-authority-replaced");
    }

    startup_trace.record("runs-handoff-opening");
    tauri::async_runtime::block_on(runs_handoff::open_gate(
        &data_directory,
        &database,
        graphql_api,
    ))?;
    startup_trace.record("runs-handoff-opened");
    let spool = ticketry_runs::HookSpool::new(
        spool_directory,
        ticketry_runs::RunsServices::new(database.clone())
            .lifecycle()
            .clone(),
        ticketry_runs::DEFAULT_BATCH_SIZE,
    )
    .map_err(|error| format!("terminal lifecycle startup failed: {error}"))?;
    let reconciliation = ticketry_terminal::TerminalReconciliationService::new(
        database.clone(),
        Arc::new(composed.terminal_runtime().clone()),
        Arc::new(ticketry_terminal::TmuxCleanupRuntime::default()),
    );

    tauri::async_runtime::block_on(workspace_handoff::open_gate(
        &data_directory,
        &composed,
        graphql_api,
        application,
    ))?;
    startup_trace.record("workspace-handoff-opened");
    *state
        .configuration
        .lock()
        .expect("runtime configuration lock poisoned") = Some(rust_runtime_configuration());
    *state.mcp_runtime.lock().expect("MCP runtime lock poisoned") = mcp_runtime.take();

    // The shell renders on the `ready` health below. Terminal recovery and
    // execution reconciliation take seconds on a large installation and gate
    // only their own mutations, so they finish behind the open shell.
    // Automated launches keep the synchronous order because their exit code
    // reports startup failures.
    let recovery = RecoveryRuntimes {
        handle: application.clone(),
        data_directory: data_directory.clone(),
        database,
        composed,
        spool,
        reconciliation,
        terminal_launch,
    };
    if automated_startup_exit_requested() {
        tauri::async_runtime::block_on(recovery.start())?;
    } else {
        let handle = application.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(message) = recovery.start().await {
                eprintln!("Ticketry desktop recovery runtimes failed to start: {message}");
                let health =
                    ServiceHealth::failed_runtime(message, &data_directory.join("ticketry.log"));
                handle
                    .state::<DesktopServiceState>()
                    .publish(&handle, health);
            }
        });
    }
    state.publish(application, ServiceHealth::ready());
    startup_trace.record("rust-runtime-ready");
    Ok(())
}

/// The runtimes that recover durable terminal and execution state after the
/// window is already open.
struct RecoveryRuntimes {
    handle: tauri::AppHandle,
    data_directory: std::path::PathBuf,
    database: sea_orm::DatabaseConnection,
    composed: ComposedCommandRuntime,
    spool: ticketry_runs::HookSpool,
    reconciliation: ticketry_terminal::TerminalReconciliationService,
    terminal_launch: ticketry_terminal::TerminalLaunchService,
}

impl RecoveryRuntimes {
    async fn start(self) -> Result<(), String> {
        let startup_trace = self.handle.state::<DesktopStartupTrace>();
        let state = self.handle.state::<DesktopServiceState>();
        let periodic_spool = self.spool.clone();
        let terminal_runtime = Arc::new(
            TerminalLifecycleRuntime::start(
                Arc::new(ProductionTerminalLifecycleWork::new(
                    self.database.clone(),
                    self.spool,
                    self.reconciliation,
                    self.composed.viewer_ownership().clone(),
                )),
                TerminalLifecycleConfig {
                    sweep_interval: terminal_sweep_interval(),
                    ..TerminalLifecycleConfig::default()
                },
            )
            .await
            .map_err(|error| format!("terminal lifecycle startup failed: {error}"))?,
        );
        startup_trace.record("terminal-lifecycle-started");
        let (_, hook_spool_runtime) = periodic_spool
            .start(provider_hook_sweep_interval())
            .await
            .map_err(|error| format!("provider hook ingestion startup failed: {error}"))?;
        startup_trace.record("provider-hook-ingestion-started");
        let execution_service =
            ticketry_agent_execution::reconciliation::ExecutionReconciliationService::new(
                self.database.clone(),
                ticketry_work_management::launch_policy::LaunchPolicyResolver::new(
                    self.database.clone(),
                ),
                self.terminal_launch.clone(),
            );
        let execution_runtime =
            ticketry_agent_execution::reconciliation::ExecutionReconciliationRuntime::start(
                execution_service,
                Arc::clone(&terminal_runtime),
                ticketry_agent_execution::reconciliation::ExecutionReconciliationConfig::default(),
            )
            .await
            .map_err(|error| format!("execution reconciliation startup failed: {error}"))?;
        startup_trace.record("execution-reconciliation-started");

        let complete = ticketry_settings::Slice2Readiness::complete();
        ticketry_settings::publish_readiness(&self.data_directory, &complete)
            .map_err(|error| format!("could not publish Slice 2 readiness: {error}"))?;
        state.readiness.record(&complete);
        *state
            .terminal_runtime
            .lock()
            .expect("terminal runtime lock poisoned") = Some(terminal_runtime);
        *state
            .hook_spool_runtime
            .lock()
            .expect("hook spool runtime lock poisoned") = Some(hook_spool_runtime);
        *state
            .execution_runtime
            .lock()
            .expect("execution runtime lock poisoned") = Some(execution_runtime);
        *state
            .terminal_launch
            .lock()
            .expect("terminal launch lock poisoned") = Some(self.terminal_launch);
        *state
            .output_sweep
            .lock()
            .expect("output sweep lock poisoned") =
            Some(ticketry_terminal::LiveOutputSweepRuntime::start(
                self.composed.output_activity().clone(),
                ticketry_terminal::configured_sweep_interval(),
            ));
        startup_trace.record("recovery-runtimes-ready");
        Ok(())
    }
}

fn terminal_sweep_interval() -> Duration {
    #[cfg(feature = "desktop-acceptance")]
    if let Some(milliseconds) = std::env::var("TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        return Duration::from_millis(milliseconds.max(25));
    }

    // Launch lease recovery must not inherit the old idle-cleanup interval.
    TerminalLifecycleConfig::default().sweep_interval
}

#[cfg(all(test, not(feature = "desktop-acceptance")))]
#[test]
fn launch_recovery_runs_every_fifteen_seconds() {
    assert_eq!(terminal_sweep_interval(), Duration::from_secs(15));
}

fn provider_hook_sweep_interval() -> Duration {
    #[cfg(feature = "desktop-acceptance")]
    if let Some(milliseconds) = std::env::var("TICKETRY_DESKTOP_ACCEPTANCE_HOOK_SWEEP_MILLIS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        return Duration::from_millis(milliseconds.max(25));
    }

    Duration::from_secs(1)
}
