//! One-shot launch of the packaged service pair: sidecar backend plus the
//! in-process MCP listener. Every failure path leaves published health, the
//! stored runtime contract, and process ownership consistent.

use tauri::Manager;

use crate::data_directory::established_data_directory;
use crate::desktop::environment::{
    optional_port, smoke_startup_exit_requested, DEVELOPMENT_BACKEND_PORT_ENV,
    DEVELOPMENT_MCP_PORT_ENV, PACKAGED_HOOK_RUNNER_ENV,
};
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::mcp_runtime::{
    configured_mcp_port, start_in_process_mcp, WORKTRACKER_MCP_PORT,
};
use crate::desktop::packaged_binaries::{hook_runner_binary, sidecar_binary};
use crate::desktop::runs_handoff;
use crate::desktop::runtime_configuration::sidecar_runtime_configuration;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::sidecar_probe::verify_packaged_backend;
use crate::desktop::webview_origin::desktop_webview_origin;
use crate::desktop::workspace_handoff;
use crate::sidecar_supervision::{
    self, CommandTable, Supervisor, SupervisorError, SupervisorOptions,
};
use crate::terminal_lifecycle::{
    hook_spool_directory, ProductionTerminalLifecycleWork, TerminalLifecycleConfig,
    TerminalLifecycleRuntime,
};
use crate::{graphql_foundation, settings_persistence, tool_discovery as discovery};
use std::sync::Arc;
use std::time::Duration;

fn development_supervisor_options() -> Result<SupervisorOptions, String> {
    let mut options = SupervisorOptions::default();
    // External MCP clients get one stable endpoint in both development and
    // packaged launches. An occupied port is an actionable startup error; the
    // supervisor must not silently move a public endpoint.
    options.mcp_port_candidates = vec![WORKTRACKER_MCP_PORT];
    options.mcp_required = false;
    if cfg!(debug_assertions) {
        match (
            optional_port(DEVELOPMENT_BACKEND_PORT_ENV)?,
            optional_port(DEVELOPMENT_MCP_PORT_ENV)?,
        ) {
            (Some(backend), Some(mcp)) => {
                options.port_candidates = vec![backend];
                options.mcp_port_candidates = vec![mcp];
            }
            (None, None) => {}
            _ => {
                return Err(
                    "MUXED_DESKTOP_BACKEND_PORT and MUXED_DESKTOP_MCP_PORT must be set together"
                        .to_owned(),
                )
            }
        }
    }
    Ok(options)
}

pub(crate) fn launch_packaged_backend(
    application: &tauri::App,
    graphql_api: &tauri_graphql::TransportApiImpl,
    bootstrap_worktracker: bool,
) -> Result<(), String> {
    let state = application.state::<DesktopServiceState>();
    state.publish(application.handle(), ServiceHealth::starting());
    state.publish(application.handle(), ServiceHealth::migrating());

    let binary = sidecar_binary(application)?;
    let hook_runner = hook_runner_binary(application)?;
    let data_dir = established_data_directory().map_err(|error| error.to_string())?;
    let unavailable = settings_persistence::Slice2Readiness::unavailable();
    settings_persistence::publish_readiness(&data_dir, &unavailable)
        .map_err(|error| format!("could not close the Slice 2 readiness gate: {error}"))?;
    state.readiness.record(&unavailable);
    runs_handoff::close_gate(&data_dir)
        .map_err(|error| format!("could not close the Slice 3 readiness gate: {error}"))?;
    workspace_handoff::close_gate(&data_dir)
        .map_err(|error| format!("could not close the Slice 4 readiness gate: {error}"))?;
    let origin = desktop_webview_origin()?;
    let mcp_port = configured_mcp_port()?;
    let commands = CommandTable::packaged_backend(binary, &data_dir, &origin)
        .map_err(|error| error.to_string())?
        .with_environment({
            let mut environment = discovery::resolved_tool_environment()?;
            environment.push((
                PACKAGED_HOOK_RUNNER_ENV.to_owned(),
                hook_runner.to_string_lossy().into_owned(),
            ));
            environment.push((
                "WORKTRACKER_MCP_URL".to_owned(),
                format!("http://127.0.0.1:{mcp_port}/mcp"),
            ));
            environment.push(("TICKETRY_RUST_WORKTRACKER_OWNER".to_owned(), "1".to_owned()));
            environment.push(("TICKETRY_RUST_SLICE2_OWNER".to_owned(), "1".to_owned()));
            environment.push(("TICKETRY_RUST_SLICE3_OWNER".to_owned(), "1".to_owned()));
            // The sidecar keeps serving unmigrated capabilities, and this is
            // how it learns it may no longer write documents or worktrees.
            environment.push(("TICKETRY_RUST_SLICE4_OWNER".to_owned(), "1".to_owned()));
            // Rust performs the required startup pass and owns both periodic
            // terminal recovery and provider-hook drains from this launch on.
            environment.push(("TICKETRY_RUST_SLICE5_OWNER".to_owned(), "1".to_owned()));
            environment
        });
    let mut supervisor = Supervisor::try_new(commands, development_supervisor_options()?)
        .map_err(|error| error.to_string())?;
    if let Err(error) = supervisor.launch() {
        let log_path = supervisor.log_path().to_path_buf();
        state.publish(
            application.handle(),
            ServiceHealth::failed(&error, &log_path),
        );
        // Preserve the fixed command table so Retry can succeed after the user
        // resolves a collision or other actionable startup condition.
        *state.supervisor.lock().expect("supervisor lock poisoned") = Some(supervisor);
        return Err(format!(
            "desktop {} failed to start: {}; logs: {}",
            error.service,
            error.message,
            log_path.display()
        ));
    }
    let port = supervisor
        .port()
        .expect("ready supervisor retains its assigned port");
    if bootstrap_worktracker {
        match tauri::async_runtime::block_on(graphql_foundation::adopt_worktracker_and_install(
            &data_dir.join("rust-core.sqlite3"),
            &data_dir,
            graphql_api,
        )) {
            Ok(adopted) => application
                .state::<DesktopLaunchRuntime>()
                .record(adopted.runtime),
            Err(error) => {
                let message = format!("fresh WorkTracker adoption failed: {}", error.message);
                let failure = SupervisorError {
                    service: "worktracker-adoption".to_owned(),
                    kind: sidecar_supervision::FailureKind::Migration,
                    message: message.clone(),
                };
                state.publish(
                    application.handle(),
                    ServiceHealth::failed(&failure, supervisor.log_path()),
                );
                let _ = supervisor.shutdown();
                return Err(message);
            }
        }
    }
    let launch_runtime = application.state::<DesktopLaunchRuntime>();
    let composed = launch_runtime.composed_runtime()?.clone();
    let runs_commands = composed.commands().clone();
    launch_runtime.configure_terminal_authority(
        crate::terminal_lifecycle::TerminalRuntimeAuthority {
            database: runs_commands.clone(),
            paths: crate::launch_paths::LaunchPathsService::new(
                runs_commands.clone(),
                composed.profiles().clone(),
            ),
            hook_runner: hook_runner.clone(),
            hook_spool_directory: hook_spool_directory(&data_dir),
            lifecycle_url: format!("http://127.0.0.1:{mcp_port}/runs/lifecycle"),
            mcp_url: format!("http://127.0.0.1:{mcp_port}/mcp"),
            backend_base_url: format!("http://127.0.0.1:{port}/api"),
            backend_api_key: supervisor.credential().to_owned(),
        },
    )?;
    let terminal_launch = crate::terminal_launch::TerminalLaunchService::new(
        runs_commands.clone(),
        Arc::new(composed.terminal_runtime().clone()),
    );
    let mcp_runtime = match tauri::async_runtime::block_on(start_in_process_mcp(
        &data_dir,
        port,
        supervisor.credential(),
        mcp_port,
        Some(terminal_launch.clone()),
    )) {
        Ok(runtime) => runtime,
        Err(message) => {
            let error = SupervisorError {
                service: "mcp".to_owned(),
                kind: sidecar_supervision::FailureKind::Bind,
                message: message.clone(),
            };
            state.publish(
                application.handle(),
                ServiceHealth::failed(&error, supervisor.log_path()),
            );
            *state.supervisor.lock().expect("supervisor lock poisoned") = Some(supervisor);
            return Err(message);
        }
    };
    state.retain_supervisor_notices(&supervisor.events());
    if smoke_startup_exit_requested() {
        if let Err(message) = verify_packaged_backend(port, supervisor.credential(), &origin) {
            let error = SupervisorError {
                service: "backend".to_owned(),
                kind: sidecar_supervision::FailureKind::Authentication,
                message,
            };
            state.publish(
                application.handle(),
                ServiceHealth::failed(&error, supervisor.log_path()),
            );
            let _ = supervisor.shutdown();
            return Err("desktop backend smoke authentication check failed".to_owned());
        }
    }
    let complete = settings_persistence::Slice2Readiness::complete();
    if let Err(error) = settings_persistence::publish_readiness(&data_dir, &complete) {
        tauri::async_runtime::block_on(mcp_runtime.shutdown());
        let _ = supervisor.shutdown();
        return Err(format!("could not publish Slice 2 readiness: {error}"));
    }
    state.readiness.record(&complete);
    // Slice 3 opens after Slice 2 and separately: it needs the sidecar to answer
    // the effect-port health probe and to drain the durable launch backlog
    // before Studio is told that Runs status is live.
    if let Err(message) = tauri::async_runtime::block_on(runs_handoff::open_gate(
        &data_dir,
        &runs_commands,
        graphql_api,
    )) {
        let error = SupervisorError {
            service: "runs-handoff".to_owned(),
            kind: sidecar_supervision::FailureKind::Migration,
            message: message.clone(),
        };
        state.publish(
            application.handle(),
            ServiceHealth::failed(&error, supervisor.log_path()),
        );
        tauri::async_runtime::block_on(mcp_runtime.shutdown());
        let _ = supervisor.shutdown();
        return Err(message);
    }
    let spool = match crate::hook_spool::HookSpool::new(
        hook_spool_directory(&data_dir),
        crate::runs_persistence::RunsServices::new(runs_commands.clone())
            .lifecycle()
            .clone(),
        crate::hook_spool::DEFAULT_BATCH_SIZE,
    ) {
        Ok(spool) => spool,
        Err(error) => {
            let message = format!("terminal lifecycle startup failed: {error}");
            tauri::async_runtime::block_on(mcp_runtime.shutdown());
            let _ = supervisor.shutdown();
            return Err(message);
        }
    };
    let launch_runtime = Arc::new(composed.terminal_runtime().clone());
    let cleanup_runtime = Arc::new(crate::terminal_cleanup::TmuxCleanupRuntime::default());
    let reconciliation = crate::terminal_reconciliation::TerminalReconciliationService::new(
        runs_commands.clone(),
        launch_runtime,
        cleanup_runtime,
    );
    let viewer_ownership = composed.viewer_ownership().clone();
    let terminal_work = ProductionTerminalLifecycleWork::new(
        runs_commands.clone(),
        spool,
        reconciliation,
        viewer_ownership,
    );
    let terminal_config = TerminalLifecycleConfig {
        sweep_interval: terminal_sweep_interval(),
        ..TerminalLifecycleConfig::default()
    };
    let terminal_runtime = match tauri::async_runtime::block_on(TerminalLifecycleRuntime::start(
        Arc::new(terminal_work),
        terminal_config,
    )) {
        Ok(runtime) => runtime,
        Err(error) => {
            let message = format!("terminal lifecycle startup failed: {error}");
            tauri::async_runtime::block_on(mcp_runtime.shutdown());
            let _ = supervisor.shutdown();
            return Err(message);
        }
    };
    let terminal_runtime = Arc::new(terminal_runtime);
    let execution_service = crate::execution_reconciliation::ExecutionReconciliationService::new(
        runs_commands.clone(),
        crate::work_management::launch_policy::LaunchPolicyResolver::new(
            runs_commands.clone(),
            composed.profiles().clone(),
        ),
        terminal_launch,
    );
    let execution_runtime = match tauri::async_runtime::block_on(
        crate::execution_reconciliation::ExecutionReconciliationRuntime::start(
            execution_service,
            Arc::clone(&terminal_runtime),
            crate::execution_reconciliation::ExecutionReconciliationConfig::default(),
        ),
    ) {
        Ok(runtime) => runtime,
        Err(error) => {
            let message = format!("execution reconciliation startup failed: {error}");
            let _ = tauri::async_runtime::block_on(terminal_runtime.shutdown());
            tauri::async_runtime::block_on(mcp_runtime.shutdown());
            let _ = supervisor.shutdown();
            return Err(message);
        }
    };
    // Slice 4 opens last. Unlike Runs it needs nothing from the sidecar — that
    // is what the cutover bought — but it must open after adoption has run and
    // the schema is composed, which is true for both the fresh-store and the
    // already-adopted startup paths by the time control reaches here.
    if let Err(message) = tauri::async_runtime::block_on(workspace_handoff::open_gate(
        &data_dir,
        &composed,
        graphql_api,
        application.handle(),
    )) {
        let error = SupervisorError {
            service: "workspace-handoff".to_owned(),
            kind: sidecar_supervision::FailureKind::Migration,
            message: message.clone(),
        };
        state.publish(
            application.handle(),
            ServiceHealth::failed(&error, supervisor.log_path()),
        );
        tauri::async_runtime::block_on(execution_runtime.shutdown());
        let _ = tauri::async_runtime::block_on(terminal_runtime.shutdown());
        tauri::async_runtime::block_on(mcp_runtime.shutdown());
        let _ = supervisor.shutdown();
        return Err(message);
    }
    let configuration = sidecar_runtime_configuration(port, supervisor.credential());
    *state
        .configuration
        .lock()
        .expect("runtime configuration lock poisoned") = Some(configuration);
    *state.supervisor.lock().expect("supervisor lock poisoned") = Some(supervisor);
    *state.mcp_runtime.lock().expect("MCP runtime lock poisoned") = Some(mcp_runtime);
    *state
        .terminal_runtime
        .lock()
        .expect("terminal runtime lock poisoned") = Some(terminal_runtime);
    *state
        .execution_runtime
        .lock()
        .expect("execution runtime lock poisoned") = Some(execution_runtime);
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
    const DEFAULT_MINUTES: u64 = 30;
    let minutes = std::env::var("MUXED_IDLE_SWEEP_MINUTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_MINUTES);
    Duration::from_secs(minutes.saturating_mul(60))
}
