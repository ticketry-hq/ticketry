//! What happens once, before the window appears: decide whether this process
//! owns the data directory, adopt or bootstrap the GraphQL foundation, and
//! either launch the supervised pair or connect to a development stack.

use tauri::Manager;

use crate::data_directory::established_data_directory;
use crate::desktop::backend_launch::launch_packaged_backend;
use crate::desktop::data_directory::DesktopDataDirectoryOwnership;
use crate::desktop::environment::smoke_startup_exit_requested;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::runtime_configuration::{
    development_runtime_configuration, failed_runtime_configuration,
};
use crate::desktop::service_health::{ServiceHealth, ServiceHealthState};
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::supervisor_monitor::start_supervisor_monitor;
use crate::sidecar_supervision::{self, SupervisorError};
use crate::{graphql_foundation, settings_persistence};

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
    let bootstrap_worktracker =
        owns_data_directory && !ownership.data_directory.join("state.db").is_file();
    if startup_error.is_none() && owns_data_directory {
        let unavailable = settings_persistence::Slice2Readiness::unavailable();
        match settings_persistence::publish_readiness(&ownership.data_directory, &unavailable) {
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
    if startup_error.is_none() && !bootstrap_worktracker {
        let foundation_database = ownership.data_directory.join("rust-core.sqlite3");
        match tauri::async_runtime::block_on(graphql_foundation::adopt_worktracker_and_install(
            &foundation_database,
            &ownership.data_directory,
            graphql_api,
        )) {
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
        let log_path = sidecar_supervision::sidecar_log_path(&ownership.data_directory);
        let health = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: sidecar_supervision::FailureKind::Crash,
                message,
            },
            &log_path,
        );
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") =
            Some(failed_runtime_configuration(health.clone()));
        state.publish(application.handle(), health);
    } else if owns_data_directory {
        if let Err(message) =
            launch_packaged_backend(application, graphql_api, bootstrap_worktracker)
        {
            eprintln!("Ticketry desktop services failed to initialize: {message}");
            if smoke_startup_exit_requested() {
                return Err(message.into());
            }
            let log_path = sidecar_supervision::sidecar_log_path(
                established_data_directory().map_err(|error| error.to_string())?,
            );
            let health = {
                let existing = state
                    .health
                    .lock()
                    .expect("service health lock poisoned")
                    .clone();
                if existing.state == ServiceHealthState::Failed {
                    existing
                } else {
                    ServiceHealth::failed(
                        &SupervisorError {
                            service: "backend".to_owned(),
                            kind: sidecar_supervision::FailureKind::Crash,
                            message,
                        },
                        &log_path,
                    )
                }
            };
            *state
                .configuration
                .lock()
                .expect("runtime configuration lock poisoned") =
                Some(failed_runtime_configuration(health.clone()));
            state.publish(application.handle(), health);
        } else {
            start_supervisor_monitor(application.handle().clone());
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
