//! The planner listener's one-per-process startup and joined shutdown.

use std::sync::atomic::Ordering;

use tauri::Manager;

use super::{
    data_directory::DesktopDataDirectoryOwnership, service_health::ServiceHealth,
    service_state::DesktopServiceState,
};

pub(crate) fn start_planner_service(
    application: &tauri::AppHandle,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), String> {
    let state = application.state::<DesktopServiceState>();
    let mut installed = state
        .planner_runtime
        .lock()
        .map_err(|_| "Ticketry planner state lock is poisoned")?;
    if state.stopping.load(Ordering::Acquire) {
        return Err(
            "Ticketry planner startup was cancelled because the application is stopping".to_owned(),
        );
    }
    if installed.is_some() {
        return Ok(());
    }
    let port = super::environment::planner_port()?;
    let handle = application.clone();
    let log_path = application
        .state::<DesktopDataDirectoryOwnership>()
        .data_directory
        .join("ticketry.log");
    let runtime = tauri::async_runtime::block_on(ticketry_planner::PlannerService::start(
        api.clone(),
        port,
        move |message| {
            eprintln!("{message}");
            handle
                .state::<DesktopServiceState>()
                .publish(&handle, ServiceHealth::failed_runtime(message, &log_path));
        },
    ))?;
    if state.stopping.load(Ordering::Acquire) {
        tauri::async_runtime::block_on(runtime.shutdown())?;
        return Err(
            "Ticketry planner startup was cancelled because the application is stopping".to_owned(),
        );
    }
    *installed = Some(runtime);
    Ok(())
}

pub(crate) fn stop_planner_service(state: &DesktopServiceState) {
    let runtime = state
        .planner_runtime
        .lock()
        .expect("planner runtime lock poisoned")
        .take();
    if let Some(runtime) = runtime {
        if let Err(error) = tauri::async_runtime::block_on(runtime.shutdown()) {
            eprintln!("{error}");
        }
    }
}
