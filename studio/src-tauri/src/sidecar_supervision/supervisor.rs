//! The supervisor itself: what it holds, and what a caller can read from it.
//!
//! Launching, recovery, and teardown are the three things it does, and each
//! lives in its own module beside this one.

use rand::{distributions::Alphanumeric, Rng};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use super::captured_logs::CapturedLogs;
use super::command_table::CommandTable;
use super::error::{FailureKind, SupervisorError};
use super::events::SupervisorEvent;
use super::mcp_port::read_persisted_mcp_port;
use super::options::SupervisorOptions;
use super::owned_sidecar::OwnedSidecar;

pub(super) struct RunningSidecar {
    pub(super) sidecar: OwnedSidecar,
    pub(super) port: u16,
}

pub(super) struct LivenessProbe {
    pub(super) stopped: Arc<AtomicBool>,
    pub(super) consecutive_failures: Arc<AtomicUsize>,
}

impl Drop for LivenessProbe {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

pub struct Supervisor {
    pub(super) commands: CommandTable,
    pub(super) options: SupervisorOptions,
    pub(super) credential: String,
    pub(super) logs: Arc<Mutex<CapturedLogs>>,
    pub(super) log_path: PathBuf,
    pub(super) events: Arc<Mutex<Vec<SupervisorEvent>>>,
    pub(super) running: Option<RunningSidecar>,
    pub(super) running_mcp: Option<RunningSidecar>,
    pub(super) pinned_port: Option<u16>,
    pub(super) pinned_mcp_port: Option<u16>,
    pub(super) persisted_mcp_port: Option<u16>,
    pub(super) persist_mcp_port: bool,
    pub(super) launched_once: bool,
    pub(super) liveness_probe: Option<LivenessProbe>,
    pub(super) restarts: usize,
    pub(super) next_recovery: Option<(String, Instant)>,
    pub(super) healthy_since: Option<Instant>,
    pub(super) shutting_down: bool,
    pub(super) reported_sidecar_log_errors: HashSet<String>,
}

impl Supervisor {
    pub fn new(commands: CommandTable, options: SupervisorOptions) -> Self {
        Self::try_new(commands, options)
            .unwrap_or_else(|error| panic!("could not initialize sidecar supervision: {error}"))
    }

    pub fn try_new(
        commands: CommandTable,
        options: SupervisorOptions,
    ) -> Result<Self, SupervisorError> {
        let credential = generate_credential();
        let log_path = commands.sidecar_log_path.clone();
        let persist_mcp_port = commands.mcp.is_some() && options.mcp_port_candidates.is_empty();
        let persisted_mcp_port = persist_mcp_port
            .then(|| read_persisted_mcp_port(&commands.mcp_port_path))
            .flatten();
        let logs = CapturedLogs::new(
            options.log_limit_bytes,
            options.sidecar_log_limit_bytes,
            options.sidecar_log_generations,
            credential.clone(),
            log_path.clone(),
        )
        .map_err(|error| {
            SupervisorError::new(
                FailureKind::Crash,
                format!(
                    "could not create sidecar log {}: {error}",
                    log_path.display()
                ),
            )
        })?;
        Ok(Self {
            commands,
            logs: Arc::new(Mutex::new(logs)),
            log_path,
            options,
            credential,
            events: Arc::new(Mutex::new(Vec::new())),
            running: None,
            running_mcp: None,
            pinned_port: None,
            pinned_mcp_port: persisted_mcp_port,
            persisted_mcp_port,
            persist_mcp_port,
            launched_once: false,
            liveness_probe: None,
            restarts: 0,
            next_recovery: None,
            healthy_since: None,
            shutting_down: false,
            reported_sidecar_log_errors: HashSet::new(),
        })
    }

    /// Starts the fixed backend command and returns only after its structured
    /// readiness line is observed.

    pub fn events(&self) -> Vec<SupervisorEvent> {
        self.events.lock().expect("events lock poisoned").clone()
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs.lock().expect("logs lock poisoned").snapshot()
    }

    /// Append one already-labelled desktop record through the same redaction,
    /// rotation, and error-reporting path used for supervised child output.
    pub fn append_log_line(&self, line: &str) {
        let mut logs = self.logs.lock().expect("logs lock poisoned");
        let redacted = logs.redact(line);
        logs.push_redacted(redacted);
    }

    pub fn log_path(&self) -> &Path {
        &self.log_path
    }

    pub fn port(&self) -> Option<u16> {
        self.running.as_ref().map(|child| child.port)
    }

    pub fn mcp_port(&self) -> Option<u16> {
        self.running_mcp.as_ref().map(|child| child.port)
    }

    pub fn credential(&self) -> &str {
        &self.credential
    }

    pub(super) fn emit(&self, event: SupervisorEvent) {
        self.events
            .lock()
            .expect("events lock poisoned")
            .push(event);
    }

    pub(super) fn record_failure(&self, error: SupervisorError) -> SupervisorError {
        self.record_service_failure("backend", error)
    }

    pub(super) fn record_service_failure(
        &self,
        service: &str,
        error: SupervisorError,
    ) -> SupervisorError {
        let message = self
            .logs
            .lock()
            .expect("logs lock poisoned")
            .redact(&error.message);
        self.emit(SupervisorEvent::Failed {
            service: service.to_owned(),
            kind: error.kind,
            message: message.clone(),
        });
        SupervisorError {
            service: service.to_owned(),
            kind: error.kind,
            message,
        }
    }

    pub(super) fn report_pending_sidecar_log_error(&mut self) {
        let error = self
            .logs
            .lock()
            .expect("logs lock poisoned")
            .take_disk_error();
        let Some(error) = error else {
            return;
        };
        let message = format!(
            "could not write sidecar log {}: {error}",
            self.log_path.display()
        );
        if self.reported_sidecar_log_errors.insert(message.clone()) {
            self.emit(SupervisorEvent::SidecarLogUnavailable { message });
        }
    }
}

pub(super) fn generate_credential() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

/// Cleanup remains best effort.  This runs during ordinary unwinding — a
/// supervisor leaving scope, a failed startup, a panic in a build that unwinds
/// — and it cannot run after an abrupt death of the desktop process itself: a
/// macOS `SIGKILL` (Force Quit, the out-of-memory killer), a power loss, a
/// build configured to abort on panic, or an operating-system crash all skip
/// destructors.  Nor does it promise anything for a descendant that
/// deliberately left the owned group.  A group stranded either way outlives
/// this shell: the next launch reclaims the data-directory lock the kernel
/// released and supervises its own sidecars, and never signals the strays,
/// which it does not own.
impl Drop for Supervisor {
    fn drop(&mut self) {
        self.liveness_probe = None;
        // The same ordered, exactly-once take as explicit shutdown and
        // recovery; only the bound differs, because nothing is waiting on a
        // grace period once the supervisor itself is going away.
        for (_service, mut running) in self.take_owned_sidecars() {
            running.sidecar.terminate_and_reap_best_effort();
        }
    }
}
