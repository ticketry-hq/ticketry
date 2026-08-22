//! Starting the backend and MCP sidecars, and waiting for each to announce
//! readiness.

use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use super::captured_logs::start_log_readers;
use super::command_table::sanitize_packaged_process_environment;
use super::control_protocol::{drain_control_failures, parse_control_line, ControlLine};
use super::error::{process_error, FailureKind, SupervisorError};
use super::events::SupervisorEvent;
use super::health_probe::{backend_health_probe_succeeds, mcp_initialize_succeeds};
use super::loopback_port::{select_loopback_port, select_pinned_loopback_port};
use super::owned_sidecar::OwnedSidecar;
use super::reaping::{stop_after_exit_before_readiness, stop_and_reap};
use super::supervisor::{generate_credential, LivenessProbe, RunningSidecar};
use super::Supervisor;

pub(super) const CREDENTIAL_ENV: &str = "MUXED_SIDECAR_CREDENTIAL";

pub(super) const MCP_URL_ENV: &str = "WORKTRACKER_MCP_URL";

pub(super) const READINESS_TERMINAL_DRAIN: Duration = Duration::from_millis(50);

impl Supervisor {
    pub fn launch(&mut self) -> Result<(), SupervisorError> {
        if self.running.is_some() {
            return Ok(());
        }
        self.shutting_down = false;
        self.pinned_port = None;
        self.pinned_mcp_port = self.persisted_mcp_port;
        self.launched_once = false;
        self.restarts = 0;
        self.next_recovery = None;
        self.healthy_since = None;
        self.credential = generate_credential();
        self.logs
            .lock()
            .expect("logs lock poisoned")
            .replace_secret(self.credential.clone());
        self.spawn_supervised_pair(true)?;
        self.launched_once = true;
        self.healthy_since = Some(Instant::now());
        Ok(())
    }

    pub(super) fn spawn_supervised_pair(
        &mut self,
        allow_persisted_fallback: bool,
    ) -> Result<(), SupervisorError> {
        let mcp_reservation = match self
            .commands
            .mcp
            .as_ref()
            .map(|_| self.reserve_mcp_port(allow_persisted_fallback))
            .transpose()
        {
            Ok(reservation) => reservation,
            Err(error) if !self.options.mcp_required => {
                self.record_service_failure("mcp", error);
                None
            }
            Err(error) => return Err(self.record_service_failure("mcp", error)),
        };
        let mcp_port = mcp_reservation.as_ref().map(|reservation| {
            reservation
                .listener
                .local_addr()
                .expect("MCP reservation has local address")
                .port()
        });
        let rollover_from = mcp_reservation
            .as_ref()
            .and_then(|reservation| reservation.rollover_from);
        self.running = Some(
            self.spawn_and_wait(mcp_port)
                .map_err(|error| self.record_failure(error))?,
        );
        if let Some(port) = mcp_port {
            drop(mcp_reservation);
            match self.spawn_mcp_and_wait(port) {
                Ok(running) => {
                    self.running_mcp = Some(running);
                    if let Err(error) = self.commit_mcp_port(port, rollover_from) {
                        if let Some(mut mcp) = self.running_mcp.take() {
                            let _ = stop_and_reap(&mut mcp.sidecar);
                        }
                        let error = self.record_service_failure("mcp", error);
                        if self.options.mcp_required {
                            if let Some(mut backend) = self.running.take() {
                                let _ = stop_and_reap(&mut backend.sidecar);
                            }
                            return Err(error);
                        }
                    }
                }
                Err(error) => {
                    let error = self.record_service_failure("mcp", error);
                    if self.options.mcp_required {
                        if let Some(mut backend) = self.running.take() {
                            let _ = stop_and_reap(&mut backend.sidecar);
                        }
                        return Err(error);
                    }
                }
            }
        }
        self.pinned_port.get_or_insert(
            self.running
                .as_ref()
                .expect("spawned backend remains owned")
                .port,
        );
        if let Some(running_mcp) = self.running_mcp.as_ref() {
            self.pinned_mcp_port.get_or_insert(running_mcp.port);
        }
        self.start_liveness_probe();
        Ok(())
    }

    /// Observes an unexpected exit.  A bounded restart is attempted before a
    /// crash failure is reported to the Tauri lifecycle owner.

    pub(super) fn start_liveness_probe(&mut self) {
        self.liveness_probe = None;
        let Some(port) = self.running.as_ref().map(|running| running.port) else {
            return;
        };
        let stopped = Arc::new(AtomicBool::new(false));
        let consecutive_failures = Arc::new(AtomicUsize::new(0));
        let thread_stopped = Arc::clone(&stopped);
        let thread_failures = Arc::clone(&consecutive_failures);
        let interval = self.options.liveness_probe_interval;
        let timeout = self.options.liveness_probe_timeout;
        thread::spawn(move || loop {
            thread::sleep(interval);
            if thread_stopped.load(Ordering::Relaxed) {
                break;
            }
            if backend_health_probe_succeeds(port, timeout) {
                thread_failures.store(0, Ordering::Relaxed);
            } else {
                let _ = thread_failures.fetch_update(
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                    |failures| Some(failures.saturating_add(1)),
                );
            }
        });
        self.liveness_probe = Some(LivenessProbe {
            stopped,
            consecutive_failures,
        });
    }

    pub(super) fn spawn_and_wait(
        &mut self,
        mcp_port: Option<u16>,
    ) -> Result<RunningSidecar, SupervisorError> {
        let port = match self.pinned_port {
            Some(port) => select_pinned_loopback_port(
                port,
                self.options.bind_retry_timeout,
                self.options.bind_retry_interval,
            )?,
            None => select_loopback_port(&self.options.port_candidates)?,
        };
        let mut command = Command::new(&self.commands.backend.program);
        command.args(&self.commands.backend.fixed_arguments);
        if self.commands.backend.pass_port_argument {
            command.arg("--port").arg(port.to_string());
        }
        command
            .env(CREDENTIAL_ENV, &self.credential)
            .env("MUXED_BACKEND_PORT", port.to_string())
            .envs(self.commands.backend.environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        sanitize_packaged_process_environment(&mut command);
        if let Some(mcp_port) = mcp_port {
            command.env(MCP_URL_ENV, format!("http://127.0.0.1:{mcp_port}/mcp"));
        }
        let mut sidecar = OwnedSidecar::spawn(command).map_err(process_error)?;
        self.emit(SupervisorEvent::Spawned {
            service: "backend".to_owned(),
            port,
        });
        let receiver = start_log_readers(&mut sidecar, Arc::clone(&self.logs))?;

        let deadline = Instant::now() + self.options.readiness_timeout;
        loop {
            if let Some(status) = sidecar.try_direct_child_exit().map_err(process_error)? {
                self.emit(SupervisorEvent::Exited {
                    service: "backend".to_owned(),
                    status: status.code(),
                });
                let failure = drain_control_failures(&receiver, port, READINESS_TERMINAL_DRAIN);
                self.report_pending_sidecar_log_error();
                let crash = stop_after_exit_before_readiness(&mut sidecar, "backend", status);
                if let Some(error) = failure {
                    return Err(error);
                }
                return Err(crash);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let failure = drain_control_failures(&receiver, port, READINESS_TERMINAL_DRAIN);
                self.report_pending_sidecar_log_error();
                let cleanup = stop_and_reap(&mut sidecar);
                if let Some(error) = failure {
                    return Err(error);
                }
                cleanup?;
                return Err(SupervisorError::new(
                    FailureKind::ReadinessTimeout,
                    "backend did not emit readiness before the deadline",
                ));
            }
            match receiver.recv_timeout(remaining.min(Duration::from_millis(20))) {
                Ok(line) => {
                    let control_line = parse_control_line(&line, port);
                    self.report_pending_sidecar_log_error();
                    match control_line {
                        ControlLine::Ready => {
                            if let Some(status) =
                                sidecar.try_direct_child_exit().map_err(process_error)?
                            {
                                self.emit(SupervisorEvent::Exited {
                                    service: "backend".to_owned(),
                                    status: status.code(),
                                });
                                let failure = drain_control_failures(
                                    &receiver,
                                    port,
                                    READINESS_TERMINAL_DRAIN,
                                );
                                self.report_pending_sidecar_log_error();
                                let crash = stop_after_exit_before_readiness(
                                    &mut sidecar,
                                    "backend",
                                    status,
                                );
                                if let Some(error) = failure {
                                    return Err(error);
                                }
                                return Err(crash);
                            }
                            self.emit(SupervisorEvent::Ready {
                                service: "backend".to_owned(),
                                port,
                            });
                            return Ok(RunningSidecar { sidecar, port });
                        }
                        ControlLine::Failure(kind, message) => {
                            let _ = stop_and_reap(&mut sidecar);
                            return Err(SupervisorError::new(kind, message));
                        }
                        ControlLine::Other => {}
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {}
            }
        }
    }

    pub(super) fn spawn_mcp_and_wait(
        &mut self,
        port: u16,
    ) -> Result<RunningSidecar, SupervisorError> {
        let backend_port = self
            .running
            .as_ref()
            .map(|child| child.port)
            .ok_or_else(|| SupervisorError::new(FailureKind::Crash, "backend is not ready"))?;
        let command_spec =
            self.commands.mcp.clone().ok_or_else(|| {
                SupervisorError::new(FailureKind::Crash, "MCP command is missing")
            })?;
        let mut command = Command::new(&command_spec.program);
        command
            .args(&command_spec.fixed_arguments)
            .env(CREDENTIAL_ENV, &self.credential)
            .env("MCP_HOST", "127.0.0.1")
            .env("MCP_PORT", port.to_string())
            .env("MCP_TRANSPORT", "http")
            .env("MUXED_BACKEND_PORT", backend_port.to_string())
            .env(
                "WORKTRACKER_BASE_URL",
                format!("http://127.0.0.1:{backend_port}/api/work-tracker"),
            )
            .env("WORKTRACKER_API_KEY", &self.credential)
            .env(
                "STUDIO_RUN_CONTROL_URL",
                format!("http://127.0.0.1:{backend_port}/api/terminals/self-terminate"),
            )
            .envs(command_spec.environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        sanitize_packaged_process_environment(&mut command);
        let mut sidecar = OwnedSidecar::spawn(command).map_err(process_error)?;
        self.emit(SupervisorEvent::Spawned {
            service: "mcp".to_owned(),
            port,
        });
        let _receiver = start_log_readers(&mut sidecar, Arc::clone(&self.logs))?;
        let deadline = Instant::now() + self.options.readiness_timeout;
        loop {
            self.report_pending_sidecar_log_error();
            if let Some(status) = sidecar.try_direct_child_exit().map_err(process_error)? {
                return Err(stop_after_exit_before_readiness(
                    &mut sidecar,
                    "MCP service",
                    status,
                ));
            }
            if Instant::now() >= deadline {
                stop_and_reap(&mut sidecar)?;
                return Err(SupervisorError::new(
                    FailureKind::ReadinessTimeout,
                    "MCP service did not complete initialization before the deadline",
                ));
            }
            if mcp_initialize_succeeds(port, deadline) {
                self.emit(SupervisorEvent::Ready {
                    service: "mcp".to_owned(),
                    port,
                });
                return Ok(RunningSidecar { sidecar, port });
            }
            if Instant::now() >= deadline {
                stop_and_reap(&mut sidecar)?;
                return Err(SupervisorError::new(
                    FailureKind::ReadinessTimeout,
                    "MCP service did not complete initialization before the deadline",
                ));
            }
            thread::sleep(
                Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }
}
