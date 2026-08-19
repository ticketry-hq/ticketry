//! The background watcher for the launched pair. It polls the supervisor,
//! restarts a stopped MCP listener, keeps the Slice 2 readiness gate honest,
//! and translates supervisor events into published health and notices.

use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::Manager;

use crate::desktop::mcp_runtime::ensure_in_process_mcp;
use crate::desktop::runs_handoff;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::service_state::DesktopServiceState;
use crate::ownership::established_data_directory;
use crate::runs_effect_port;
use crate::supervisor::{self, SupervisorError, SupervisorEvent};
use crate::{runs_persistence, settings_persistence, work_management};

fn recovery_health_updates(events: &[SupervisorEvent], pair_is_ready: bool) -> Vec<ServiceHealth> {
    if !events.iter().any(|event| {
        matches!(
            event,
            SupervisorEvent::RecoveryQueued { .. } | SupervisorEvent::Restarting { .. }
        )
    }) {
        return Vec::new();
    }

    let mut updates = vec![ServiceHealth::recovering()];
    if pair_is_ready {
        updates.push(ServiceHealth::ready());
    }
    updates
}

/// Keep the Slice 3 gate equal to what the pair can actually serve.
///
/// A stopped pair closes it immediately, because a status subscription that
/// cannot reach the terminal executor must refuse rather than look healthy. A
/// recovered pair reopens it only after the executor answers and the durable
/// launch backlog drains, so recovery cannot resurrect a stale `ready: true`.
fn runs_gate_result(
    application: &tauri::AppHandle,
    supervisor: &crate::supervisor::Supervisor,
    pair_is_ready: bool,
) -> Result<(), String> {
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    if !pair_is_ready {
        return runs_persistence::published_readiness_is_complete(&data_directory)
            .then(|| runs_handoff::close_gate(&data_directory).map_err(|error| error.to_string()))
            .unwrap_or(Ok(()));
    }
    if runs_persistence::published_readiness_is_complete(&data_directory) {
        return Ok(());
    }
    let Some(port) = supervisor.port() else {
        return Ok(());
    };
    let commands = application
        .state::<crate::desktop::launch_runtime::DesktopLaunchRuntime>()
        .commands()?
        .clone();
    let effect_port = runs_effect_port::RunsEffectPort::new(
        format!("http://127.0.0.1:{port}/api"),
        supervisor.credential().to_owned(),
    );
    tauri::async_runtime::block_on(runs_handoff::reopen_gate(
        &data_directory,
        &commands,
        &effect_port,
    ))
}

pub(crate) fn start_supervisor_monitor(application: tauri::AppHandle) {
    thread::spawn(move || {
        let mut observed_events = {
            let state = application.state::<DesktopServiceState>();
            let event_count = state
                .supervisor
                .lock()
                .expect("supervisor lock poisoned")
                .as_ref()
                .map(|supervisor| supervisor.events().len())
                .unwrap_or(0);
            event_count
        };

        loop {
            thread::sleep(Duration::from_millis(250));
            let state = application.state::<DesktopServiceState>();
            if state.stopping.load(Ordering::Acquire) {
                return;
            }
            let mut supervisor_guard = state.supervisor.lock().expect("supervisor lock poisoned");
            let Some(supervisor) = supervisor_guard.as_mut() else {
                continue;
            };
            let result = supervisor.poll();
            let events = supervisor.events();
            let new_events = events.get(observed_events..).unwrap_or(&[]);
            let backend_is_ready = supervisor.port().is_some();
            let mcp_error = if result.is_ok() && backend_is_ready {
                ensure_in_process_mcp(&state, supervisor).err()
            } else {
                None
            };
            let pair_is_ready = backend_is_ready
                && state
                    .mcp_runtime
                    .lock()
                    .expect("MCP runtime lock poisoned")
                    .as_ref()
                    .is_some_and(work_management::mcp::McpRuntime::is_running);
            let readiness = if pair_is_ready {
                settings_persistence::Slice2Readiness::complete()
            } else {
                settings_persistence::Slice2Readiness::unavailable()
            };
            // The readiness file records transitions, not polls: rewrite it
            // only when the computed result differs from the last published
            // one, so an idle desktop stops fsyncing the data directory four
            // times a second.
            let readiness_result = established_data_directory()
                .map_err(|error| error.to_string())
                .and_then(|directory| {
                    state
                        .readiness
                        .publish_if_changed(&directory, &readiness)
                        .map_err(|error| error.to_string())
                });
            // The Runs gate follows the same pair, but reopening it is not a
            // file write: the temporary terminal executor must answer, and the
            // durable launch backlog must drain, before status is live again.
            let runs_result = runs_gate_result(&application, supervisor, pair_is_ready);
            let health_updates = recovery_health_updates(new_events, pair_is_ready);
            observed_events = events.len();

            for event in new_events {
                if let SupervisorEvent::SidecarLogUnavailable { message } = event {
                    eprintln!("Ticketry sidecar log unavailable: {message}");
                }
            }
            state.publish_supervisor_notices(&application, new_events);
            // Publish before releasing the supervisor lock so a retry cannot
            // overtake this poll result with a newer health transition.
            for health in health_updates {
                state.publish(&application, health);
            }
            if let Err(error) = result {
                state.publish(
                    &application,
                    ServiceHealth::failed(&error, supervisor.log_path()),
                );
            } else if let Some(message) = mcp_error {
                state.publish(
                    &application,
                    ServiceHealth::failed(
                        &SupervisorError {
                            service: "mcp".to_owned(),
                            kind: supervisor::FailureKind::Crash,
                            message,
                        },
                        supervisor.log_path(),
                    ),
                );
            } else if let Err(error) = readiness_result {
                state.publish(
                    &application,
                    ServiceHealth::failed(
                        &SupervisorError {
                            service: "slice2-readiness".to_owned(),
                            kind: supervisor::FailureKind::Crash,
                            message: error.to_string(),
                        },
                        supervisor.log_path(),
                    ),
                );
            } else if let Err(error) = runs_result {
                state.publish(
                    &application,
                    ServiceHealth::failed(
                        &SupervisorError {
                            service: "slice3-readiness".to_owned(),
                            kind: supervisor::FailureKind::Crash,
                            message: error,
                        },
                        supervisor.log_path(),
                    ),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_health::ServiceHealthState;

    #[test]
    fn recovery_attempt_reports_recovering_then_ready_for_a_serving_pair() {
        let updates = recovery_health_updates(
            &[supervisor::SupervisorEvent::Restarting {
                service: "backend".to_owned(),
                attempt: 1,
            }],
            true,
        );

        assert_eq!(
            updates
                .iter()
                .map(|health| health.state)
                .collect::<Vec<_>>(),
            vec![ServiceHealthState::Recovering, ServiceHealthState::Ready]
        );
    }

    #[test]
    fn queued_recovery_reports_recovering_before_the_pair_is_serving() {
        let updates = recovery_health_updates(
            &[supervisor::SupervisorEvent::RecoveryQueued {
                service: "backend".to_owned(),
            }],
            false,
        );

        assert_eq!(
            updates
                .iter()
                .map(|health| health.state)
                .collect::<Vec<_>>(),
            vec![ServiceHealthState::Recovering]
        );
    }
}
