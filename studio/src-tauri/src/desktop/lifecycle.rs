//! Application lifecycle: what each Tauri run event means for the process,
//! and the teardown every exit path must perform.

use std::sync::atomic::Ordering;
use tauri::Manager;

use crate::desktop::data_directory::DesktopDataDirectoryOwnership;
use crate::desktop::service_state::DesktopServiceState;
use crate::terminal::viewer::webview_commands;
use crate::{native_terminal, settings_persistence};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopLifecycleEvent {
    StartupReady,
    FatalInitialization,
    MainWindowCloseRequested,
    ApplicationShutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopLifecycleAction {
    Continue,
    Exit(i32),
    Finished,
}

pub(crate) fn lifecycle_action(event: DesktopLifecycleEvent) -> DesktopLifecycleAction {
    match event {
        DesktopLifecycleEvent::StartupReady => DesktopLifecycleAction::Continue,
        DesktopLifecycleEvent::FatalInitialization => DesktopLifecycleAction::Exit(1),
        DesktopLifecycleEvent::MainWindowCloseRequested => DesktopLifecycleAction::Exit(0),
        DesktopLifecycleEvent::ApplicationShutdown => DesktopLifecycleAction::Finished,
    }
}

pub(crate) fn detach_transient_viewers(application: &tauri::AppHandle) {
    // These views live outside the WebView. Detaching them on both page reload
    // and application exit prevents a stale native surface from covering the
    // freshly loaded Studio layout without signalling or killing durable tmux
    // sessions.
    application
        .state::<webview_commands::ViewerCommandState>()
        .detach_all();
    application
        .state::<native_terminal::NativeTerminalState>()
        .detach_all();
}

pub(crate) fn shutdown_rust_runtime(application: &tauri::AppHandle) {
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
    let unavailable = settings_persistence::Slice2Readiness::unavailable();
    if settings_persistence::publish_readiness(&ownership.data_directory, &unavailable).is_ok() {
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
