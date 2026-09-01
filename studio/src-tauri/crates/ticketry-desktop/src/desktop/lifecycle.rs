//! Application lifecycle: what each Tauri run event means for the process,
//! and the teardown every exit path must perform.

use std::sync::atomic::Ordering;
use tauri::Manager;

use crate::desktop::data_directory::{
    release_data_directory_ownership, DesktopDataDirectoryOwnership,
};
use crate::desktop::service_state::DesktopServiceState;
use crate::native_terminal;
use ticketry_terminal::ViewerCommandState;

pub const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopLifecycleEvent {
    StartupReady,
    FatalInitialization,
    MainWindowCloseRequested,
    ApplicationShutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopLifecycleAction {
    Continue,
    Exit(i32),
    Finished,
}

pub fn lifecycle_action(event: DesktopLifecycleEvent) -> DesktopLifecycleAction {
    match event {
        DesktopLifecycleEvent::StartupReady => DesktopLifecycleAction::Continue,
        DesktopLifecycleEvent::FatalInitialization => DesktopLifecycleAction::Exit(1),
        DesktopLifecycleEvent::MainWindowCloseRequested => DesktopLifecycleAction::Exit(0),
        DesktopLifecycleEvent::ApplicationShutdown => DesktopLifecycleAction::Finished,
    }
}

pub fn detach_transient_viewers(application: &tauri::AppHandle) {
    // These views live outside the WebView. Detaching them on both page reload
    // and application exit prevents a stale native surface from covering the
    // freshly loaded Studio layout without signalling or killing durable tmux
    // sessions.
    application
        .state::<ViewerCommandState>()
        .detach_all();
    application
        .state::<native_terminal::NativeTerminalState>()
        .detach_all();
}

/// The teardown every exit path performs, whether the user closed the window
/// or an installed update is about to relaunch the process.
///
/// Restarting into an update runs this first so the new process finds a
/// released data-directory lock, a clean Session Marker, and no stranded
/// sidecar or terminal processes from the version it replaced.
pub fn tear_down_before_exit(application: &tauri::AppHandle) {
    shutdown_rust_runtime(application);
    detach_transient_viewers(application);
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    if let Err(error) = ticketry_diagnostics::clean_session_marker(&ownership.data_directory) {
        eprintln!("Ticketry could not remove its Session Marker: {error}");
    }
    release_data_directory_ownership(application);
}

pub fn shutdown_rust_runtime(application: &tauri::AppHandle) {
    let state = application.state::<DesktopServiceState>();
    state.stopping.store(true, Ordering::Release);
    // Live document discovery is the first thing to stop: a watcher settling
    // into a store that is about to close would write for a workspace nobody
    // is looking at any more.
    if let Some(launch) =
        application.try_state::<crate::desktop::launch_runtime::DesktopLaunchRuntime>()
    {
        launch.stop_document_watchers();
    }
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let unavailable = ticketry_settings::Slice2Readiness::unavailable();
    if ticketry_settings::publish_readiness(&ownership.data_directory, &unavailable).is_ok() {
        state.readiness.record(&unavailable);
    }
    // Runs status must be closed before the pair goes down, so a relaunch
    // never inherits a `ready: true` record from a process that is gone.
    let _ = crate::desktop::runs_handoff::close_gate(&ownership.data_directory);
    let _ = crate::desktop::workspace_handoff::close_gate(&ownership.data_directory);
    let output_sweep = state
        .output_sweep
        .lock()
        .expect("output sweep lock poisoned")
        .take();
    if let Some(runtime) = output_sweep {
        tauri::async_runtime::block_on(runtime.shutdown());
    }
    let execution_runtime = state
        .execution_runtime
        .lock()
        .expect("execution runtime lock poisoned")
        .take();
    if let Some(runtime) = execution_runtime {
        tauri::async_runtime::block_on(runtime.shutdown());
    }
    let hook_spool_runtime = state
        .hook_spool_runtime
        .lock()
        .expect("hook spool runtime lock poisoned")
        .take();
    if let Some(runtime) = hook_spool_runtime {
        let _ = tauri::async_runtime::block_on(runtime.shutdown());
    }
    let terminal_runtime = state
        .terminal_runtime
        .lock()
        .expect("terminal runtime lock poisoned")
        .take();
    if let Some(runtime) = terminal_runtime {
        if let Err(error) = tauri::async_runtime::block_on(runtime.shutdown()) {
            eprintln!("Ticketry could not finish terminal shutdown: {error}");
        }
    }
    let mcp_runtime = state
        .mcp_runtime
        .lock()
        .expect("MCP runtime lock poisoned")
        .take();
    if let Some(runtime) = mcp_runtime {
        tauri::async_runtime::block_on(runtime.shutdown());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_outcomes_cover_startup_failure_close_and_shutdown() {
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::StartupReady),
            DesktopLifecycleAction::Continue
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::FatalInitialization),
            DesktopLifecycleAction::Exit(1)
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::MainWindowCloseRequested),
            DesktopLifecycleAction::Exit(0)
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::ApplicationShutdown),
            DesktopLifecycleAction::Finished
        );
    }
}
