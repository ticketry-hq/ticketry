//! Process-local startup after the no-sidecar cutover.

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::data_directory::established_data_directory;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::mcp_runtime::{configured_mcp_port, start_in_process_mcp};
use crate::desktop::packaged_binaries::hook_runner_binary;
use crate::desktop::runtime_configuration::rust_runtime_configuration;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::{runs_handoff, workspace_handoff};
use crate::settings_persistence;
use crate::terminal_lifecycle::{
    ProductionTerminalLifecycleWork, TerminalLifecycleConfig, TerminalLifecycleRuntime,
};

pub(crate) fn launch_rust_runtime(
    application: &tauri::App,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), String> {
    let state = application.state::<DesktopServiceState>();
    state.publish(application.handle(), ServiceHealth::starting());
    state.publish(application.handle(), ServiceHealth::migrating());

    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let hook_runner = hook_runner_binary(application)?;
    let launch_runtime = application.state::<DesktopLaunchRuntime>();
    let composed = launch_runtime.composed_runtime()?.clone();
    let database = composed.commands().clone();
    let spool_directory = crate::terminal_lifecycle::ensure_hook_spool_directory(&data_directory)?;

    let terminal_launch = crate::terminal_launch::TerminalLaunchService::new(
        database.clone(),
        Arc::new(composed.terminal_runtime().clone()),
    )
    .with_authority(Arc::new(
        crate::launch_authority::LaunchAuthorityService::new(database.clone()),
    ));
    launch_runtime.configure_terminal_authority(
        crate::terminal_lifecycle::TerminalRuntimeAuthority {
            database: database.clone(),
            paths: crate::launch_paths::LaunchPathsService::new(database.clone()),
            hook_runner,
            hook_spool_directory: spool_directory.clone(),
            mcp_url: String::new(),
            run_authority: crate::work_management::mcp::RunAuthority::new(database.clone()),
        },
    )?;

    let credential = uuid::Uuid::new_v4().simple().to_string();
    let mut mcp_runtime = match tauri::async_runtime::block_on(start_in_process_mcp(
        &data_directory,
        &credential,
        configured_mcp_port()?,
        Some(terminal_launch.clone()),
    )) {
        Ok(runtime) => Some(runtime),
        Err(message) => {
            state.retain_notice(crate::desktop::user_notices::mcp_unavailable(
                &message,
                "Restart Ticketry to request another loopback endpoint.",
            ));
            None
        }
    };
    if let Some(runtime) = mcp_runtime.as_ref() {
        launch_runtime.replace_terminal_mcp_authority(
            format!("http://{}/mcp", runtime.address()),
            runtime.authority(),
        )?;
    }

    tauri::async_runtime::block_on(runs_handoff::open_gate(
        &data_directory,
        &database,
        graphql_api,
    ))?;
    let spool = crate::hook_spool::HookSpool::new(
        spool_directory,
        crate::runs_persistence::RunsServices::new(database.clone())
            .lifecycle()
            .clone(),
        crate::hook_spool::DEFAULT_BATCH_SIZE,
    )
    .map_err(|error| format!("terminal lifecycle startup failed: {error}"))?;
    let reconciliation = crate::terminal_reconciliation::TerminalReconciliationService::new(
        database.clone(),
        Arc::new(composed.terminal_runtime().clone()),
        Arc::new(crate::terminal_cleanup::TmuxCleanupRuntime::default()),
    );
    let terminal_runtime = Arc::new(
        tauri::async_runtime::block_on(TerminalLifecycleRuntime::start(
            Arc::new(ProductionTerminalLifecycleWork::new(
                database.clone(),
                spool,
                reconciliation,
                composed.viewer_ownership().clone(),
            )),
            TerminalLifecycleConfig {
                sweep_interval: terminal_sweep_interval(),
                ..TerminalLifecycleConfig::default()
            },
        ))
        .map_err(|error| format!("terminal lifecycle startup failed: {error}"))?,
    );
    let execution_service = crate::execution_reconciliation::ExecutionReconciliationService::new(
        database.clone(),
        crate::work_management::launch_policy::LaunchPolicyResolver::new(database.clone()),
        terminal_launch.clone(),
    );
    let execution_runtime = tauri::async_runtime::block_on(
        crate::execution_reconciliation::ExecutionReconciliationRuntime::start(
            execution_service,
            Arc::clone(&terminal_runtime),
            crate::execution_reconciliation::ExecutionReconciliationConfig::default(),
        ),
    )
    .map_err(|error| format!("execution reconciliation startup failed: {error}"))?;

    tauri::async_runtime::block_on(workspace_handoff::open_gate(
        &data_directory,
        &composed,
        graphql_api,
        application.handle(),
    ))?;
    let complete = settings_persistence::Slice2Readiness::complete();
    settings_persistence::publish_readiness(&data_directory, &complete)
        .map_err(|error| format!("could not publish Slice 2 readiness: {error}"))?;
    state.readiness.record(&complete);

    *state
        .configuration
        .lock()
        .expect("runtime configuration lock poisoned") = Some(rust_runtime_configuration());
    *state.mcp_runtime.lock().expect("MCP runtime lock poisoned") = mcp_runtime.take();
    *state
        .terminal_runtime
        .lock()
        .expect("terminal runtime lock poisoned") = Some(terminal_runtime);
    *state
        .execution_runtime
        .lock()
        .expect("execution runtime lock poisoned") = Some(execution_runtime);
    *state
        .terminal_launch
        .lock()
        .expect("terminal launch lock poisoned") = Some(terminal_launch);
    *state
        .output_sweep
        .lock()
        .expect("output sweep lock poisoned") = Some(
        crate::terminal_output_activity::LiveOutputSweepRuntime::start(
            composed.output_activity().clone(),
            crate::terminal_output_activity::configured_sweep_interval(),
        ),
    );
    state.publish(application.handle(), ServiceHealth::ready());
    Ok(())
}

fn terminal_sweep_interval() -> Duration {
    #[cfg(feature = "desktop-acceptance")]
    if let Some(milliseconds) = std::env::var("TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        return Duration::from_millis(milliseconds.max(25));
    }

    const DEFAULT_MINUTES: u64 = 30;
    let minutes = std::env::var("MUXED_IDLE_SWEEP_MINUTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_MINUTES);
    Duration::from_secs(minutes.saturating_mul(60))
}
