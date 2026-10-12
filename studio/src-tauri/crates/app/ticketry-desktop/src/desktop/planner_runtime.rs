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
    install_planner_service(&application.state::<DesktopServiceState>(), || {
        let port = super::environment::planner_port()?;
        let frontend_origin = super::environment::planner_frontend_origin(application.config())?;
        let handle = application.clone();
        let log_path = application
            .state::<DesktopDataDirectoryOwnership>()
            .data_directory
            .join("ticketry.log");
        tauri::async_runtime::block_on(ticketry_planner::PlannerService::start(
            api.clone(),
            port,
            frontend_origin,
            move |message| {
                eprintln!("{message}");
                handle
                    .state::<DesktopServiceState>()
                    .publish(&handle, ServiceHealth::failed_runtime(message, &log_path));
            },
        ))
    })
}

/// Install the one planner listener `start` opens, unless the compiled edition
/// lacks sprint planning: then no listener is opened and the runtime
/// configuration never publishes a planner endpoint.
fn install_planner_service(
    state: &DesktopServiceState,
    start: impl FnOnce() -> Result<ticketry_planner::PlannerService, String>,
) -> Result<(), String> {
    if !ticketry_edition::has(ticketry_edition::EditionCapability::SprintPlanning) {
        return Ok(());
    }
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
    let runtime = start()?;
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

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use async_graphql::dynamic::{Field, FieldFuture, FieldValue, Object, Schema, TypeRef};
    use tauri_graphql::{GraphQlEndpoint, TransportApiImpl};
    use ticketry_edition::{has, EditionCapability};

    use super::*;
    use crate::desktop::runtime_configuration::rust_runtime_configuration;

    fn installed_api() -> TransportApiImpl {
        let query = Object::new("Query").field(Field::new(
            "ready",
            TypeRef::named_nn(TypeRef::BOOLEAN),
            |_| FieldFuture::new(async { Ok(Some(FieldValue::value(true))) }),
        ));
        let api = TransportApiImpl::new();
        api.install_endpoint(GraphQlEndpoint::new(
            Schema::build("Query", None, None)
                .register(query)
                .finish()
                .unwrap(),
        ))
        .unwrap();
        api
    }

    #[test]
    fn ready_runtime_opens_a_planner_listener_only_where_sprint_planning_is_granted() {
        let state = DesktopServiceState::new();
        *state.configuration.lock().unwrap() = Some(rust_runtime_configuration());
        state.record_health(ServiceHealth::ready());
        let started = Cell::new(false);

        install_planner_service(&state, || {
            started.set(true);
            tauri::async_runtime::block_on(ticketry_planner::PlannerService::start(
                installed_api(),
                0,
                None,
                |_| {},
            ))
        })
        .expect("planner composition");

        let published =
            serde_json::to_value(state.configuration().expect("runtime configuration")).unwrap();
        if has(EditionCapability::SprintPlanning) {
            assert!(started.get(), "core opens the planner listener");
            let url = published["plannerEndpoint"]["graphqlUrl"]
                .as_str()
                .unwrap_or_else(|| panic!("core publishes a planner endpoint: {published}"));
            assert!(url.starts_with("http://127.0.0.1:"), "{url}");
            stop_planner_service(&state);
        } else {
            assert!(!started.get(), "Pocock never opens a planner listener");
            assert!(state.planner_runtime.lock().unwrap().is_none());
            assert_eq!(published.get("plannerEndpoint"), None, "{published}");
        }
    }
}
