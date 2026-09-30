//! What happens once when the process starts: decide whether this process
//! owns the data directory, adopt or bootstrap the GraphQL foundation, and
//! either launch the supervised pair or connect to a development stack.
//!
//! Plugin setup starts services on a worker before Tauri creates its windows.
//! Database adoption and WebView creation can therefore overlap. Services use
//! managed state and paths, never a window handle. The frontend reads the live
//! health even if services finished before its event listener was registered.
//! Automated launches still start synchronously in the app setup hook so their
//! exit code reports startup failures.

use tauri::Manager;

use crate::desktop::data_directory::DesktopDataDirectoryOwnership;
use crate::desktop::environment::automated_startup_exit_requested;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::runtime_configuration::{
    development_runtime_configuration, failed_runtime_configuration, rust_runtime_configuration,
};
use crate::desktop::rust_runtime_launch::launch_rust_runtime;
use crate::desktop::service_health::{ServiceHealth, ServiceHealthState};
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::startup_trace::DesktopStartupTrace;
use ticketry_data_directory::established_data_directory;

pub fn initialize_services(
    application: &mut tauri::App,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = application.handle().clone();
    handle
        .state::<DesktopStartupTrace>()
        .record("tauri-setup-entered");
    if automated_startup_exit_requested() {
        return start_services(&handle, graphql_api);
    }
    Ok(())
}

/// Tauri initializes plugins before creating the configured windows.
pub(crate) fn startup_plugin(
    graphql_api: tauri_graphql::TransportApiImpl,
) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("ticketry-startup")
        .setup(move |application, _| {
            if !automated_startup_exit_requested() {
                start_services_in_background(application, &graphql_api)?;
            }
            Ok(())
        })
        .build()
}

fn start_services_in_background(
    application: &tauri::AppHandle,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = application.clone();
    // `desktop_runtime_configuration` answers immediately; the configuration
    // call overlays the live health, which is still `starting`.
    *handle
        .state::<DesktopServiceState>()
        .configuration
        .lock()
        .expect("runtime configuration lock poisoned") = Some(rust_runtime_configuration());
    let graphql_api = graphql_api.clone();
    handle
        .state::<DesktopStartupTrace>()
        .record("services-start-dispatched");
    // A plain thread: the body blocks on the async runtime, so it must not
    // run on that runtime's worker threads.
    std::thread::Builder::new()
        .name("ticketry-startup".to_owned())
        .spawn(move || {
            if let Err(error) = start_services(&handle, &graphql_api) {
                eprintln!("Ticketry desktop services failed to initialize: {error}");
            }
        })
        .map_err(|error| format!("could not spawn the startup thread: {error}"))?;
    Ok(())
}

fn start_services(
    application: &tauri::AppHandle,
    graphql_api: &tauri_graphql::TransportApiImpl,
) -> Result<(), Box<dyn std::error::Error>> {
    let startup_trace = application.state::<DesktopStartupTrace>();
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
    startup_trace.record("readiness-gates-closed");
    // A first launch no longer waits for Python to create the installation:
    // adoption provisions an empty data directory at the Rust leaf itself, so
    // one call now handles every supported input, including an empty one.
    if startup_error.is_none() {
        let foundation_database = ownership.data_directory.join("rust-core.sqlite3");
        match tauri::async_runtime::block_on(
            ticketry_graphql_schema::adopt_worktracker_and_install(
                &foundation_database,
                &ownership.data_directory,
                graphql_api,
                ticketry_graphql_schema::InstallationOwnership::Owned,
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
    startup_trace.record("foundation-adopted");
    let state = application.state::<DesktopServiceState>();
    if let Some(message) = startup_error {
        let log_path = ownership.data_directory.join("ticketry.log");
        let health = ServiceHealth::failed_runtime(message, &log_path);
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") =
            Some(failed_runtime_configuration(health.clone()));
        state.publish(application, health);
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
            state.publish(application, health);
        }
    } else {
        let configuration = development_runtime_configuration()?;
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(configuration);
        state.publish(application, ServiceHealth::ready());
    }
    startup_trace.record("services-initialized");
    Ok(())
}
