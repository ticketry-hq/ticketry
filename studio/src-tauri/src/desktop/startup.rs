//! What happens once, before the window appears: decide whether this process
//! owns the data directory, adopt or bootstrap the GraphQL foundation, and
//! either launch the supervised pair or connect to a development stack.

use tauri::Manager;

use crate::desktop::data_directory::DesktopDataDirectoryOwnership;
use crate::desktop::environment::automated_startup_exit_requested;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::runtime_configuration::{
    development_runtime_configuration, failed_runtime_configuration,
};
use crate::desktop::rust_runtime_launch::launch_rust_runtime;
use crate::desktop::service_health::{ServiceHealth, ServiceHealthState};
use crate::desktop::service_state::DesktopServiceState;
use ticketry_data_directory::established_data_directory;

pub(crate) fn initialize_services(
    application: &mut tauri::App,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), Box<dyn std::error::Error>> {
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let mut startup_error = ownership.startup_error.clone();
    let owns_data_directory = ownership
        .guard
        .lock()
        .expect("data-directory lock poisoned")
        .is_some();
    if startup_error.is_none() && owns_data_directory {
        let unavailable = ticketry_settings::Slice2Readiness::unavailable();
        match ticketry_settings::publish_readiness(&ownership.data_directory, &unavailable) {
            Ok(()) => application
                .state::<DesktopServiceState>()
                .readiness
                .record(&unavailable),
            Err(error) => {
                startup_error = Some(format!(
                    "Ticketry could not close the Slice 2 readiness gate: {error}"
                ));
            }
        }
        // A stale `ready: true` Runs record must never outlive the process that
        // published it, so the Slice 3 gate is closed on the same transition.
        if startup_error.is_none() {
            if let Err(error) = crate::desktop::runs_handoff::close_gate(&ownership.data_directory)
            {
                startup_error = Some(format!(
                    "Ticketry could not close the Slice 3 readiness gate: {error}"
                ));
            }
        }
        // The same applies to the workspace gate: a `ready: true` document and
        // worktree record from a previous process must not outlive it.
        if startup_error.is_none() {
            if let Err(error) =
                crate::desktop::workspace_handoff::close_gate(&ownership.data_directory)
            {
                startup_error = Some(format!(
                    "Ticketry could not close the Slice 4 readiness gate: {error}"
                ));
            }
        }
    }
    // A first launch no longer waits for Python to create the installation:
    // adoption provisions an empty data directory at the Rust leaf itself, so
    // one call now handles every supported input, including an empty one.
    if startup_error.is_none() {
        let foundation_database = ownership.data_directory.join("rust-core.sqlite3");
        match tauri::async_runtime::block_on(
            ticketry_graphql_schema::graphql_foundation::adopt_worktracker_and_install(
                &foundation_database,
                &ownership.data_directory,
                graphql_api,
                ticketry_graphql_schema::graphql_foundation::InstallationOwnership::Owned,
            ),
        ) {
            Ok(adopted) => application
                .state::<DesktopLaunchRuntime>()
                .record(adopted.runtime),
            Err(error) => {
                let message = format!(
                    "Ticketry GraphQL foundation is unavailable ({}): {}",
                    serde_json::to_value(error.code)
                        .unwrap_or(serde_json::Value::String("unknown".to_owned())),
                    error.message
                );
                eprintln!("{message}");
                startup_error = Some(message);
            }
        }
    }
    let state = application.state::<DesktopServiceState>();
    if let Some(message) = startup_error {
        let log_path = ownership.data_directory.join("ticketry.log");
        let health = ServiceHealth::failed_runtime(message, &log_path);
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") =
            Some(failed_runtime_configuration(health.clone()));
        state.publish(application.handle(), health);
    } else if owns_data_directory {
        if let Err(message) = launch_rust_runtime(application, graphql_api) {
            eprintln!("Ticketry desktop services failed to initialize: {message}");
            if automated_startup_exit_requested() {
                return Err(message.into());
            }
            let log_path = established_data_directory()
                .map_err(|error| error.to_string())?
                .join("ticketry.log");
            let health = {
                let existing = state
                    .health
                    .lock()
                    .expect("service health lock poisoned")
                    .clone();
                if existing.state == ServiceHealthState::Failed {
                    existing
                } else {
                    ServiceHealth::failed_runtime(message, &log_path)
                }
            };
            *state
                .configuration
                .lock()
                .expect("runtime configuration lock poisoned") =
                Some(failed_runtime_configuration(health.clone()));
            state.publish(application.handle(), health);
        }
    } else {
        let configuration = development_runtime_configuration()?;
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(configuration);
        state.publish(application.handle(), ServiceHealth::ready());
    }
    Ok(())
}
