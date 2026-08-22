//! Shutting down: stopping every sidecar this supervisor owns and reaping it.

use std::time::Duration;

use super::error::{teardown_error, SupervisorError};
use super::events::SupervisorEvent;
use super::supervisor::RunningSidecar;
use super::Supervisor;

impl Supervisor {
    /// Stops the exact sidecar handles owned by this supervisor.  MCP stops
    /// before the backend, the graceful phase is a cooperative stop request,
    /// and any surviving owned process group is then forced out and reaped.
    /// No PID lookup or process adoption occurs.
    pub fn shutdown(&mut self) -> Result<(), SupervisorError> {
        self.shutting_down = true;
        self.liveness_probe = None;
        self.next_recovery = None;
        self.healthy_since = None;
        self.stop_owned_sidecars()
    }

    /// Takes every owned handle in teardown order and stops each one.
    ///
    /// This is the single supervisor-owned teardown operation shared by
    /// explicit shutdown and recovery replacement.  MCP is always attempted
    /// before the backend, so MCP cannot issue requests into a backend that is
    /// going away, and a failure on either service is retained while the
    /// remaining owned cleanup still runs.
    pub(super) fn stop_owned_sidecars(&mut self) -> Result<(), SupervisorError> {
        let mut first_error = None;
        for (service, running) in self.take_owned_sidecars() {
            if let Err(error) = self.stop_owned_child(service, running) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    /// Every owned handle, taken exactly once, in MCP-before-backend order.
    ///
    /// Ownership moves out here, so a repeated or overlapping teardown observes
    /// no handle, does nothing, and cannot signal a stale or unrelated process.
    pub(super) fn take_owned_sidecars(&mut self) -> Vec<(&'static str, RunningSidecar)> {
        self.running_mcp
            .take()
            .map(|running| ("mcp", running))
            .into_iter()
            .chain(self.running.take().map(|running| ("backend", running)))
            .collect()
    }

    /// Releases the owned group behind a service whose direct child has already
    /// exited on its own.
    ///
    /// An exited direct child does not mean the owned group is empty: a
    /// PyInstaller-shaped sidecar's worker outlives the bootloader that spawned
    /// it and keeps holding the pinned loopback port, so simply dropping the
    /// handle would strand it and the replacement spawn would fail to bind.
    /// When the group has already drained there is nothing left to signal;
    /// when anything survives it goes through the same owned teardown that
    /// shutdown and recovery use.
    pub(super) fn stop_exited_owned_child(
        &self,
        service: &str,
        mut running: RunningSidecar,
    ) -> Result<(), SupervisorError> {
        match running.sidecar.wait_for_owned_exit(Duration::ZERO) {
            Ok(true) => Ok(()),
            Ok(false) => self.stop_owned_child(service, running),
            Err(error) => {
                running.sidecar.terminate_and_reap_best_effort();
                Err(teardown_error(error).for_service(service))
            }
        }
    }

    pub(super) fn stop_owned_child(
        &self,
        service: &str,
        mut running: RunningSidecar,
    ) -> Result<(), SupervisorError> {
        self.emit(SupervisorEvent::ShutdownTermRequested {
            service: service.to_owned(),
        });
        let graceful_result = running
            .sidecar
            .request_graceful_stop()
            .and_then(|()| {
                running
                    .sidecar
                    .wait_for_owned_exit(self.options.shutdown_grace)
            })
            .map_err(teardown_error);
        match graceful_result {
            Ok(true) => Ok(()),
            Ok(false) => {
                self.emit(SupervisorEvent::ShutdownKillRequested {
                    service: service.to_owned(),
                });
                running
                    .sidecar
                    .terminate_and_reap()
                    .map_err(|error| teardown_error(error).for_service(service))
            }
            Err(error) => {
                self.emit(SupervisorEvent::ShutdownKillRequested {
                    service: service.to_owned(),
                });
                running.sidecar.terminate_and_reap_best_effort();
                Err(error.for_service(service))
            }
        }
    }
}
