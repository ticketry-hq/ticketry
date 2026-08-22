//! Stopping a sidecar and collecting its exit.
//!
//! Only handles the supervisor created are ever reaped; containment of the
//! process group lives in [`super::owned_sidecar`].

use std::process::ExitStatus;
use std::time::Duration;

use super::error::{teardown_error, FailureKind, SupervisorError};
use crate::sidecar_supervision::owned_sidecar::OwnedSidecar;

pub(super) const STARTUP_CLEANUP_GRACE: Duration = Duration::from_millis(100);

/// The short teardown used while starting up, where a failure has already been
/// decided and the user is not waiting on the configured shutdown grace.
pub(super) fn stop_and_reap(sidecar: &mut OwnedSidecar) -> Result<(), SupervisorError> {
    let graceful_result = sidecar
        .request_graceful_stop()
        .and_then(|()| sidecar.wait_for_owned_exit(STARTUP_CLEANUP_GRACE))
        .map_err(teardown_error);
    match graceful_result {
        Ok(true) => Ok(()),
        Ok(false) => sidecar.terminate_and_reap().map_err(teardown_error),
        Err(error) => {
            sidecar.terminate_and_reap_best_effort();
            Err(error)
        }
    }
}

/// Reports a startup failure whose direct child exited before readiness, after
/// stopping the rest of the partially started group.
///
/// An exited direct child says nothing about the group it led: a bootloader
/// that hands off to a worker exits immediately while the worker keeps the
/// loopback port and the log pipes.  Startup therefore ends the owned group
/// here exactly as a readiness timeout does, giving the survivors the same
/// cooperative request and grace period the supervisor owes anything it
/// started, rather than returning and leaving them to the forced last resort a
/// dropped handle performs.
///
/// Teardown never displaces the diagnosis.  The exit status is what the caller
/// needs in order to understand the failed launch, so a cleanup error is
/// dropped rather than reported in its place — the same precedence the
/// reported-failure path already keeps.
pub(super) fn stop_after_exit_before_readiness(
    sidecar: &mut OwnedSidecar,
    service: &str,
    status: ExitStatus,
) -> SupervisorError {
    let _ = stop_and_reap(sidecar);
    SupervisorError::new(
        FailureKind::Crash,
        format!(
            "{service} exited before readiness with status {:?}",
            status.code()
        ),
    )
}
