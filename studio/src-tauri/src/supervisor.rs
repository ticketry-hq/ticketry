//! The desktop-owned lifecycle for packaged sidecars.
//!
//! This module deliberately has no "run a command" API.  A caller can only
//! construct the application-owned backend command table and the supervisor
//! only reaps sidecars whose [`OwnedSidecar`] handles it created.  Containment
//! of those sidecars lives in [`crate::owned_sidecar`]; this module owns only
//! the policy around it.

use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use crate::owned_sidecar::OwnedSidecar;

const CREDENTIAL_ENV: &str = "MUXED_SIDECAR_CREDENTIAL";
const DESKTOP_ORIGIN_ENV: &str = "MUXED_DESKTOP_ORIGIN";
const MCP_URL_ENV: &str = "WORKTRACKER_MCP_URL";
const MCP_UNAVAILABLE_ENV: &str = "WORKTRACKER_MCP_UNAVAILABLE";
const READINESS_PREFIX: &str = "MUXED_READY service=backend port=";
const FAILURE_PREFIX: &str = "MUXED_FAILURE ";
const SIDECAR_LOG_FILE_NAME: &str = "sidecar.log";
const DEVELOPMENT_LOG_PATH_ENV: &str = "MUXED_DEVELOPMENT_LOG_PATH";
const MCP_PORT_FILE_NAME: &str = "mcp-port";
const MCP_RESPONSE_LIMIT_BYTES: usize = 64 * 1024;
const READINESS_TERMINAL_DRAIN: Duration = Duration::from_millis(50);
const STARTUP_CLEANUP_GRACE: Duration = Duration::from_millis(100);
const PYINSTALLER_PARENT_ENV: [&str; 3] = [
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_ARCHIVE_FILE",
    "_PYI_PARENT_PROCESS_LEVEL",
];

fn sanitize_packaged_process_environment(command: &mut Command) {
    for name in PYINSTALLER_PARENT_ENV {
        command.env_remove(name);
    }
}

pub fn sidecar_log_path(data_directory: impl AsRef<Path>) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(configured) = std::env::var_os(DEVELOPMENT_LOG_PATH_ENV) {
        let configured = PathBuf::from(configured);
        if configured.is_absolute() {
            return configured;
        }
    }
    data_directory.as_ref().join(SIDECAR_LOG_FILE_NAME)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    Migration,
    Bind,
    ReadinessTimeout,
    Authentication,
    Crash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorError {
    pub service: String,
    pub kind: FailureKind,
    pub message: String,
}

impl SupervisorError {
    fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            service: "backend".to_owned(),
            kind,
            message: message.into(),
        }
    }

    fn for_service(mut self, service: &str) -> Self {
        self.service = service.to_owned();
        self
    }
}

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for SupervisorError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum SupervisorEvent {
    Spawned {
        service: String,
        port: u16,
    },
    Ready {
        service: String,
        port: u16,
    },
    Exited {
        service: String,
        status: Option<i32>,
    },
    Restarting {
        service: String,
        attempt: usize,
    },
    RecoveryQueued {
        service: String,
    },
    SidecarLogUnavailable {
        message: String,
    },
    McpPortRollover {
        previous_port: u16,
        active_port: u16,
    },
    ShutdownTermRequested {
        service: String,
    },
    ShutdownKillRequested {
        service: String,
    },
    Failed {
        service: String,
        kind: FailureKind,
        message: String,
    },
}

#[derive(Debug, Clone)]
pub struct SupervisorOptions {
    pub readiness_timeout: Duration,
    pub shutdown_grace: Duration,
    pub bind_retry_timeout: Duration,
    pub bind_retry_interval: Duration,
    pub liveness_probe_interval: Duration,
    pub liveness_probe_timeout: Duration,
    pub liveness_failure_threshold: usize,
    pub restart_limit: usize,
    pub restart_backoff: Vec<Duration>,
    pub healthy_reset_interval: Duration,
    pub log_limit_bytes: usize,
    /// Aggregate byte ceiling across the active sidecar log and all rotated
    /// generations.
    pub sidecar_log_limit_bytes: usize,
    /// Includes the active sidecar log. A value of three retains
    /// `sidecar.log`, `sidecar.log.1`, and `sidecar.log.2`.
    pub sidecar_log_generations: usize,
    /// Testable port-selection candidates.  An empty list means OS-selected
    /// ephemeral ports; each candidate is attempted in order.
    pub port_candidates: Vec<u16>,
    /// Testable MCP port-selection candidates with the same semantics as
    /// `port_candidates`.
    pub mcp_port_candidates: Vec<u16>,
    /// Whether an MCP startup failure must also fail the primary backend
    /// launch. Desktop builds may keep the application usable without MCP.
    pub mcp_required: bool,
}

impl Default for SupervisorOptions {
    fn default() -> Self {
        Self {
            // A cold one-file PyInstaller extraction can take longer than 15
            // seconds on development machines. Keep this aligned with the
            // packaged-sidecar acceptance budget so a healthy backend is not
            // terminated just as it reports readiness.
            readiness_timeout: Duration::from_secs(30),
            shutdown_grace: Duration::from_secs(3),
            bind_retry_timeout: Duration::from_secs(2),
            bind_retry_interval: Duration::from_millis(100),
            liveness_probe_interval: Duration::from_secs(5),
            liveness_probe_timeout: Duration::from_secs(2),
            liveness_failure_threshold: 3,
            restart_limit: 5,
            restart_backoff: vec![
                Duration::ZERO,
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
            ],
            healthy_reset_interval: Duration::from_secs(60),
            log_limit_bytes: 64 * 1024,
            sidecar_log_limit_bytes: 1024 * 1024,
            sidecar_log_generations: 3,
            port_candidates: Vec::new(),
            mcp_port_candidates: Vec::new(),
            mcp_required: true,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct BackendCommand {
    pub(crate) program: PathBuf,
    pub(crate) fixed_arguments: Vec<OsString>,
    pub(crate) environment: Vec<(OsString, OsString)>,
    pub(crate) pass_port_argument: bool,
    pub(crate) requires_owner_liveness: bool,
}

/// A fixed, application-owned command table.  This intentionally exposes no
/// arbitrary program or argument setters.
#[derive(Debug, Clone)]
pub struct CommandTable {
    pub(crate) backend: BackendCommand,
    pub(crate) mcp: Option<BackendCommand>,
    pub(crate) sidecar_log_path: PathBuf,
    pub(crate) mcp_port_path: PathBuf,
}

impl CommandTable {
    /// Builds the sole production command.  Packaging supplies this absolute
    /// path to the target-specific sidecar binary.
    pub fn packaged_backend(
        binary: impl AsRef<Path>,
        data_dir: impl AsRef<Path>,
        desktop_origin: &str,
    ) -> Result<Self, SupervisorError> {
        let program = validate_program(binary.as_ref())?;
        let data_dir = data_dir.as_ref();
        if !data_dir.is_absolute() {
            return Err(SupervisorError::new(
                FailureKind::Crash,
                "sidecar data directory must be an absolute desktop-owned path",
            ));
        }
        Ok(Self {
            backend: BackendCommand {
                program,
                fixed_arguments: vec![
                    OsString::from("--data-dir"),
                    data_dir.as_os_str().to_os_string(),
                ],
                environment: vec![(
                    OsString::from(DESKTOP_ORIGIN_ENV),
                    OsString::from(desktop_origin),
                )],
                pass_port_argument: true,
                requires_owner_liveness: true,
            },
            mcp: None,
            sidecar_log_path: sidecar_log_path(data_dir),
            mcp_port_path: data_dir.join(MCP_PORT_FILE_NAME),
        })
    }

    /// Builds the packaged backend plus the MCP mode embedded in the same
    /// validated multi-call executable.
    pub fn packaged_services(
        binary: impl AsRef<Path>,
        data_dir: impl AsRef<Path>,
        desktop_origin: &str,
    ) -> Result<Self, SupervisorError> {
        let mut commands = Self::packaged_backend(binary, data_dir, desktop_origin)?;
        commands.mcp = Some(BackendCommand {
            program: commands.backend.program.clone(),
            fixed_arguments: vec![OsString::from("mcp")],
            environment: Vec::new(),
            pass_port_argument: false,
            requires_owner_liveness: true,
        });
        Ok(commands)
    }

    /// Adds environment values selected by another application-owned service.
    /// This remains deliberately private to the Rust desktop shell: callers
    /// cannot construct arbitrary process commands or arguments.
    pub fn with_environment(mut self, environment: Vec<(String, String)>) -> Self {
        let environment = environment
            .into_iter()
            .map(|(name, value)| (OsString::from(name), OsString::from(value)))
            .collect::<Vec<_>>();
        self.backend.environment.extend(environment.clone());
        if let Some(mcp) = &mut self.mcp {
            mcp.environment.extend(environment);
        }
        self
    }

    #[cfg(test)]
    fn contract_stub(
        program: PathBuf,
        arguments: Vec<OsString>,
        environment: Vec<(OsString, OsString)>,
        sidecar_log_path: PathBuf,
    ) -> Self {
        Self {
            backend: BackendCommand {
                program,
                fixed_arguments: arguments,
                environment,
                pass_port_argument: false,
                requires_owner_liveness: false,
            },
            mcp: None,
            mcp_port_path: sidecar_log_path.with_file_name(format!(
                "{}.mcp-port",
                sidecar_log_path
                    .file_name()
                    .expect("stub sidecar log path has a file name")
                    .to_string_lossy()
            )),
            sidecar_log_path,
        }
    }
}

fn validate_program(path: &Path) -> Result<PathBuf, SupervisorError> {
    if !path.is_absolute() {
        return Err(SupervisorError::new(
            FailureKind::Crash,
            "sidecar executable must be an absolute application-owned path",
        ));
    }
    let metadata = fs::metadata(path).map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("sidecar executable is unavailable: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(SupervisorError::new(
            FailureKind::Crash,
            "sidecar executable must be a file",
        ));
    }
    Ok(path.to_path_buf())
}

#[derive(Debug, Clone)]
struct RedactedLogBuffer {
    lines: VecDeque<String>,
    bytes: usize,
    limit: usize,
    secret: String,
}

impl RedactedLogBuffer {
    fn new(limit: usize, secret: String) -> Self {
        Self {
            lines: VecDeque::new(),
            bytes: 0,
            limit,
            secret,
        }
    }

    fn redact(&self, value: &str) -> String {
        value.replace(&self.secret, "[REDACTED]")
    }

    fn push(&mut self, line: String) {
        let line_bytes = line.len() + 1;
        if self.limit == 0 || line_bytes > self.limit {
            return;
        }
        while self.bytes + line_bytes > self.limit {
            if let Some(evicted) = self.lines.pop_front() {
                self.bytes = self.bytes.saturating_sub(evicted.len() + 1);
            } else {
                break;
            }
        }
        self.bytes += line_bytes;
        self.lines.push_back(line);
    }

    fn snapshot(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }

    fn replace_secret(&mut self, secret: String) {
        self.secret = secret;
    }
}

struct RotatingSidecarLog {
    path: PathBuf,
    per_generation_limit: u64,
    generations: usize,
}

impl RotatingSidecarLog {
    fn new(path: PathBuf, total_limit: usize, generations: usize) -> std::io::Result<Self> {
        let generations = generations.max(1);
        let per_generation_limit = (total_limit / generations) as u64;
        let log = Self {
            path,
            per_generation_limit,
            generations,
        };
        log.open_active()?;
        Ok(log)
    }

    fn push(&mut self, line: &str) -> std::io::Result<()> {
        if self.per_generation_limit == 0 {
            return Ok(());
        }
        let max_line_bytes = self.per_generation_limit.saturating_sub(1) as usize;
        let end = if line.len() <= max_line_bytes {
            line.len()
        } else {
            line.char_indices()
                .map(|(index, _)| index)
                .take_while(|index| *index <= max_line_bytes)
                .last()
                .unwrap_or(0)
        };
        let bytes = &line.as_bytes()[..end];
        let write_bytes = bytes.len() as u64 + 1;
        let active_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if active_bytes > 0 && active_bytes.saturating_add(write_bytes) > self.per_generation_limit
        {
            self.rotate()?;
        }
        let mut file = self.open_active()?;
        file.write_all(bytes)?;
        file.write_all(b"\n")?;
        file.flush()
    }

    fn rotate(&self) -> std::io::Result<()> {
        for generation in (1..self.generations).rev() {
            let source = if generation == 1 {
                self.path.clone()
            } else {
                self.generation_path(generation - 1)
            };
            if !source.exists() {
                continue;
            }
            let destination = self.generation_path(generation);
            if destination.exists() {
                fs::remove_file(&destination)?;
            }
            fs::rename(source, destination)?;
        }
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        self.open_active().map(|_| ())
    }

    fn generation_path(&self, generation: usize) -> PathBuf {
        self.path.with_file_name(format!(
            "{}.{generation}",
            self.path
                .file_name()
                .expect("sidecar log path has a file name")
                .to_string_lossy()
        ))
    }

    fn open_active(&self) -> std::io::Result<File> {
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options.open(&self.path)?;
        #[cfg(unix)]
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        Ok(file)
    }
}

struct CapturedLogs {
    memory: RedactedLogBuffer,
    disk: RotatingSidecarLog,
    disk_error: Option<String>,
}

impl CapturedLogs {
    fn new(
        memory_limit: usize,
        disk_limit: usize,
        disk_generations: usize,
        secret: String,
        disk_path: PathBuf,
    ) -> std::io::Result<Self> {
        Ok(Self {
            memory: RedactedLogBuffer::new(memory_limit, secret),
            disk: RotatingSidecarLog::new(disk_path, disk_limit, disk_generations)?,
            disk_error: None,
        })
    }

    fn redact(&self, value: &str) -> String {
        self.memory.redact(value)
    }

    fn push_redacted(&mut self, line: String) {
        self.memory.push(line.clone());
        if let Err(error) = self.disk.push(&line) {
            self.disk_error = Some(error.to_string());
        }
    }

    fn snapshot(&self) -> Vec<String> {
        self.memory.snapshot()
    }

    fn replace_secret(&mut self, secret: String) {
        self.memory.replace_secret(secret);
    }

    fn take_disk_error(&mut self) -> Option<String> {
        self.disk_error.take()
    }
}

struct RunningSidecar {
    sidecar: OwnedSidecar,
    port: u16,
}

struct McpPortReservation {
    listener: TcpListener,
    rollover_from: Option<u16>,
}

struct LivenessProbe {
    stopped: Arc<AtomicBool>,
    consecutive_failures: Arc<AtomicUsize>,
}

impl Drop for LivenessProbe {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

pub struct Supervisor {
    commands: CommandTable,
    options: SupervisorOptions,
    credential: String,
    logs: Arc<Mutex<CapturedLogs>>,
    log_path: PathBuf,
    events: Arc<Mutex<Vec<SupervisorEvent>>>,
    running: Option<RunningSidecar>,
    running_mcp: Option<RunningSidecar>,
    pinned_port: Option<u16>,
    pinned_mcp_port: Option<u16>,
    persisted_mcp_port: Option<u16>,
    persist_mcp_port: bool,
    launched_once: bool,
    liveness_probe: Option<LivenessProbe>,
    restarts: usize,
    next_recovery: Option<(String, Instant)>,
    healthy_since: Option<Instant>,
    shutting_down: bool,
    reported_sidecar_log_errors: HashSet<String>,
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

    fn spawn_supervised_pair(
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
    pub fn poll(&mut self) -> Result<(), SupervisorError> {
        self.report_pending_sidecar_log_error();
        if self.shutting_down {
            return Ok(());
        }
        if let Some((_, due_at)) = self.next_recovery.as_ref() {
            if Instant::now() < *due_at {
                return Ok(());
            }
            return self.attempt_recovery();
        }
        if let Some(running) = self.running_mcp.as_mut() {
            if let Some(status) = running
                .sidecar
                .try_direct_child_exit()
                .map_err(process_error)?
            {
                self.emit(SupervisorEvent::Exited {
                    service: "mcp".to_owned(),
                    status: status.code(),
                });
                let running = self
                    .running_mcp
                    .take()
                    .expect("the exited MCP handle observed above");
                self.stop_exited_owned_child("mcp", running)?;
                return self.queue_recovery("mcp");
            }
        }
        if let Some(running) = self.running.as_mut() {
            if let Some(status) = running
                .sidecar
                .try_direct_child_exit()
                .map_err(process_error)?
            {
                self.emit(SupervisorEvent::Exited {
                    service: "backend".to_owned(),
                    status: status.code(),
                });
                let running = self
                    .running
                    .take()
                    .expect("the exited backend handle observed above");
                self.stop_exited_owned_child("backend", running)?;
                return self.queue_recovery("backend");
            }
        }
        if self.liveness_probe.as_ref().is_some_and(|probe| {
            probe.consecutive_failures.load(Ordering::Relaxed)
                >= self.options.liveness_failure_threshold.max(1)
        }) {
            return self.queue_recovery("backend");
        }
        self.restore_budget_after_continuous_health();
        Ok(())
    }

    fn queue_recovery(&mut self, failed_service: &str) -> Result<(), SupervisorError> {
        if self.shutting_down {
            return Ok(());
        }
        self.liveness_probe = None;
        self.healthy_since = None;
        // Recovery replaces the pair, so it tears down exactly what shutdown
        // does: an MCP failure is retained but never skips backend cleanup.
        self.stop_owned_sidecars()?;
        if self.restarts >= self.options.restart_limit {
            return Err(self.record_service_failure(
                failed_service,
                SupervisorError::new(
                    FailureKind::Crash,
                    format!("{failed_service} exited after restart limit was exhausted"),
                ),
            ));
        }
        let delay = self
            .options
            .restart_backoff
            .get(self.restarts)
            .copied()
            .or_else(|| self.options.restart_backoff.last().copied())
            .unwrap_or(Duration::ZERO);
        self.emit(SupervisorEvent::RecoveryQueued {
            service: failed_service.to_owned(),
        });
        self.next_recovery = Some((failed_service.to_owned(), Instant::now() + delay));
        if delay.is_zero() {
            return self.attempt_recovery();
        }
        Ok(())
    }

    fn attempt_recovery(&mut self) -> Result<(), SupervisorError> {
        let Some((_failed_service, _)) = self.next_recovery.take() else {
            return Ok(());
        };
        self.restarts += 1;
        for service in ["backend", "mcp"] {
            if service == "backend" || self.commands.mcp.is_some() {
                self.emit(SupervisorEvent::Restarting {
                    service: service.to_owned(),
                    attempt: self.restarts,
                });
            }
        }
        match self.spawn_supervised_pair(false) {
            Ok(()) => {
                self.healthy_since = Some(Instant::now());
                Ok(())
            }
            Err(error) if error.kind == FailureKind::Migration => Err(error),
            Err(error) if self.restarts < self.options.restart_limit => {
                let service = error.service.clone();
                self.queue_recovery(&service)
            }
            Err(error) => Err(error),
        }
    }

    fn restore_budget_after_continuous_health(&mut self) {
        if self.restarts == 0 || self.running.is_none() {
            return;
        }
        if self.commands.mcp.is_some() && self.running_mcp.is_none() {
            return;
        }
        if self
            .healthy_since
            .is_some_and(|since| since.elapsed() >= self.options.healthy_reset_interval)
        {
            self.restarts = 0;
            self.healthy_since = Some(Instant::now());
        }
    }

    /// Rearms a stopped supervised pair after a give-up. The fixed command
    /// table, pinned ports, and per-launch credential are retained.
    pub fn retry(&mut self) -> Result<(), SupervisorError> {
        if self.running.is_some() || self.running_mcp.is_some() {
            return Ok(());
        }
        self.shutting_down = false;
        self.restarts = 0;
        self.next_recovery = None;
        self.healthy_since = None;
        self.spawn_supervised_pair(!self.launched_once)?;
        self.launched_once = true;
        self.healthy_since = Some(Instant::now());
        Ok(())
    }

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
    fn stop_owned_sidecars(&mut self) -> Result<(), SupervisorError> {
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
    fn take_owned_sidecars(&mut self) -> Vec<(&'static str, RunningSidecar)> {
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
    fn stop_exited_owned_child(
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

    fn stop_owned_child(
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

    pub fn events(&self) -> Vec<SupervisorEvent> {
        self.events.lock().expect("events lock poisoned").clone()
    }

    #[cfg(test)]
    pub(crate) fn release_and_wait_for_backend_owner_eof_for_test(
        &mut self,
        timeout: Duration,
    ) -> std::io::Result<bool> {
        let mut running = self.running.take().expect("running backend");
        running.sidecar.release_owner_liveness();
        running.sidecar.wait_for_owned_exit(timeout)
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

    fn start_liveness_probe(&mut self) {
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

    fn spawn_and_wait(&mut self, mcp_port: Option<u16>) -> Result<RunningSidecar, SupervisorError> {
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
        // State the absence, do not leave it to be inferred. Without an MCP
        // service of our own the backend would otherwise inject its hardcoded
        // default endpoint, which is exactly the port another Studio install
        // holds when our own bind failed - and that install answers our agents'
        // run-scoped calls against a runtime that never launched them.
        match mcp_port {
            Some(mcp_port) => {
                command.env(MCP_URL_ENV, format!("http://127.0.0.1:{mcp_port}/mcp"));
            }
            None => {
                command.env(MCP_UNAVAILABLE_ENV, "1");
            }
        }
        let mut sidecar = if self.commands.backend.requires_owner_liveness {
            OwnedSidecar::spawn_backend(command)
        } else {
            OwnedSidecar::spawn(command)
        }
        .map_err(process_error)?;
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

    fn spawn_mcp_and_wait(&mut self, port: u16) -> Result<RunningSidecar, SupervisorError> {
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
        let mut sidecar = if command_spec.requires_owner_liveness {
            OwnedSidecar::spawn_backend(command)
        } else {
            OwnedSidecar::spawn(command)
        }
        .map_err(process_error)?;
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

    fn emit(&self, event: SupervisorEvent) {
        self.events
            .lock()
            .expect("events lock poisoned")
            .push(event);
    }

    fn record_failure(&self, error: SupervisorError) -> SupervisorError {
        self.record_service_failure("backend", error)
    }

    fn record_service_failure(&self, service: &str, error: SupervisorError) -> SupervisorError {
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

    fn report_pending_sidecar_log_error(&mut self) {
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

    fn reserve_mcp_port(
        &self,
        allow_persisted_fallback: bool,
    ) -> Result<McpPortReservation, SupervisorError> {
        match self.pinned_mcp_port {
            Some(port) => {
                match reserve_pinned_loopback_port(
                    port,
                    self.options.bind_retry_timeout,
                    self.options.bind_retry_interval,
                ) {
                    Ok(listener) => Ok(McpPortReservation {
                        listener,
                        rollover_from: None,
                    }),
                    Err(error)
                        if allow_persisted_fallback
                            && self.persist_mcp_port
                            && self.persisted_mcp_port == Some(port) =>
                    {
                        Ok(McpPortReservation {
                            listener: reserve_loopback_port(&self.options.mcp_port_candidates)?,
                            rollover_from: Some(port),
                        })
                    }
                    Err(error) => Err(error),
                }
            }
            None => Ok(McpPortReservation {
                listener: reserve_loopback_port(&self.options.mcp_port_candidates)?,
                rollover_from: None,
            }),
        }
    }

    fn commit_mcp_port(
        &mut self,
        active_port: u16,
        rollover_from: Option<u16>,
    ) -> Result<(), SupervisorError> {
        if self.persist_mcp_port && self.persisted_mcp_port != Some(active_port) {
            persist_mcp_port_atomically(&self.commands.mcp_port_path, active_port)?;
            self.persisted_mcp_port = Some(active_port);
        }
        self.pinned_mcp_port = Some(active_port);
        if let Some(previous_port) = rollover_from.filter(|port| *port != active_port) {
            self.emit(SupervisorEvent::McpPortRollover {
                previous_port,
                active_port,
            });
        }
        Ok(())
    }
}

fn read_persisted_mcp_port(path: &Path) -> Option<u16> {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn persist_mcp_port_atomically(path: &Path, port: u16) -> Result<(), SupervisorError> {
    let parent = path.parent().ok_or_else(|| {
        SupervisorError::new(
            FailureKind::Crash,
            "MCP port persistence path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("could not create MCP port persistence directory: {error}"),
        )
    })?;
    let temporary = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .expect("MCP port persistence path has a file name")
            .to_string_lossy(),
        std::process::id(),
        rand::thread_rng().gen::<u64>()
    ));
    let write_result = (|| -> std::io::Result<()> {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary)?;
        writeln!(file, "{port}")?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("could not persist MCP port selection: {error}"),
        )
    })
}

fn backend_health_probe_succeeds(port: u16, timeout: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return false;
    }
    if stream
        .write_all(b"GET /api/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && backend_health_response_is_healthy(&response)
}

fn backend_health_response_is_healthy(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    headers.starts_with("HTTP/1.1 200")
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|payload| payload.get("ok").and_then(serde_json::Value::as_bool))
            == Some(true)
}

fn mcp_initialize_succeeds(port: u16, deadline: Instant) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return false;
    }
    let Ok(mut stream) =
        TcpStream::connect_timeout(&address, remaining.min(Duration::from_millis(250)))
    else {
        return false;
    };
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero()
        || stream
            .set_write_timeout(Some(remaining.min(Duration::from_millis(250))))
            .is_err()
    {
        return false;
    }
    let payload = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"muxed-supervisor","version":"1"}}}"#;
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero()
            || stream
                .set_read_timeout(Some(remaining.min(Duration::from_millis(250))))
                .is_err()
        {
            return false;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                if response.len().saturating_add(count) > MCP_RESPONSE_LIMIT_BYTES {
                    return false;
                }
                response.extend_from_slice(&chunk[..count]);
                let text = String::from_utf8_lossy(&response);
                if text.contains("HTTP/1.1 200") && text.contains("\"name\":\"worktracker-agent\"")
                {
                    return true;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break;
            }
            Err(_) => break,
        }
    }
    false
}

fn generate_credential() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn reserve_loopback_port(candidates: &[u16]) -> Result<TcpListener, SupervisorError> {
    let candidates: Vec<u16> = if candidates.is_empty() {
        vec![0; 8]
    } else {
        candidates.to_vec()
    };
    for candidate in candidates {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", candidate)) {
            return Ok(listener);
        }
    }
    Err(SupervisorError::new(
        FailureKind::Bind,
        "could not reserve a loopback port after the configured retries",
    ))
}

fn select_loopback_port(candidates: &[u16]) -> Result<u16, SupervisorError> {
    let listener = reserve_loopback_port(candidates)?;
    let port = listener
        .local_addr()
        .expect("listener has local address")
        .port();
    drop(listener);
    Ok(port)
}

fn reserve_pinned_loopback_port(
    port: u16,
    retry_timeout: Duration,
    retry_interval: Duration,
) -> Result<TcpListener, SupervisorError> {
    let deadline = Instant::now() + retry_timeout;
    loop {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
        if Instant::now() >= deadline {
            return Err(SupervisorError::new(
                FailureKind::Bind,
                format!("could not rebind pinned port {port}"),
            ));
        }
        thread::sleep(retry_interval.min(deadline.saturating_duration_since(Instant::now())));
    }
}

fn select_pinned_loopback_port(
    port: u16,
    retry_timeout: Duration,
    retry_interval: Duration,
) -> Result<u16, SupervisorError> {
    drop(reserve_pinned_loopback_port(
        port,
        retry_timeout,
        retry_interval,
    )?);
    Ok(port)
}

#[derive(Debug, PartialEq, Eq)]
enum ControlLine {
    Ready,
    Failure(FailureKind, String),
    Other,
}

fn drain_control_failures(
    receiver: &mpsc::Receiver<String>,
    expected_port: u16,
    bound: Duration,
) -> Option<SupervisorError> {
    let deadline = Instant::now() + bound;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(5))) {
            Ok(line) => {
                if let ControlLine::Failure(kind, message) =
                    parse_control_line(&line, expected_port)
                {
                    return Some(SupervisorError::new(kind, message));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
}

fn parse_control_line(line: &str, expected_port: u16) -> ControlLine {
    if line == format!("{READINESS_PREFIX}{expected_port}") {
        return ControlLine::Ready;
    }
    if serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .is_some_and(|event| {
            event.get("event").and_then(|value| value.as_str()) == Some("ready")
                && event.get("host").and_then(|value| value.as_str()) == Some("127.0.0.1")
                && event.get("port").and_then(|value| value.as_u64()) == Some(expected_port.into())
        })
    {
        return ControlLine::Ready;
    }
    let Some(failure) = line.strip_prefix(FAILURE_PREFIX) else {
        return ControlLine::Other;
    };
    let (class, message) = failure
        .split_once(' ')
        .unwrap_or((failure, "sidecar failure"));
    // A class this build does not know still announced a failure. Dropping it
    // to `Other` degrades a reported failure into a readiness timeout that is
    // retried until the restart budget is gone, so an unknown class is treated
    // as a crash and keeps its raw class in the message.
    match class {
        "migration" => ControlLine::Failure(FailureKind::Migration, message.to_owned()),
        "authentication" => ControlLine::Failure(FailureKind::Authentication, message.to_owned()),
        "bind" => ControlLine::Failure(FailureKind::Bind, message.to_owned()),
        "crash" => ControlLine::Failure(FailureKind::Crash, message.to_owned()),
        _ => ControlLine::Failure(FailureKind::Crash, format!("{class}: {message}")),
    }
}

fn start_log_readers(
    sidecar: &mut OwnedSidecar,
    logs: Arc<Mutex<CapturedLogs>>,
) -> Result<mpsc::Receiver<String>, SupervisorError> {
    let stdout = sidecar.take_stdout().ok_or_else(|| {
        SupervisorError::new(FailureKind::Crash, "sidecar stdout was not captured")
    })?;
    let stderr = sidecar.take_stderr().ok_or_else(|| {
        SupervisorError::new(FailureKind::Crash, "sidecar stderr was not captured")
    })?;
    let (sender, receiver) = mpsc::channel();
    read_pipe(stdout, Some(sender), Arc::clone(&logs));
    read_pipe(stderr, None, logs);
    Ok(receiver)
}

fn read_pipe<R: std::io::Read + Send + 'static>(
    pipe: R,
    readiness: Option<mpsc::Sender<String>>,
    logs: Arc<Mutex<CapturedLogs>>,
) {
    thread::spawn(move || {
        for result in BufReader::new(pipe).lines() {
            let Ok(raw_line) = result else { break };
            {
                let mut buffer = logs.lock().expect("logs lock poisoned");
                let redacted = buffer.redact(&raw_line);
                buffer.push_redacted(redacted);
            }
            if let Some(sender) = &readiness {
                let _ = sender.send(raw_line);
            }
        }
    });
}

fn process_error(error: std::io::Error) -> SupervisorError {
    SupervisorError::new(
        FailureKind::Crash,
        format!("sidecar process error: {error}"),
    )
}

/// The short teardown used while starting up, where a failure has already been
/// decided and the user is not waiting on the configured shutdown grace.
fn stop_and_reap(sidecar: &mut OwnedSidecar) -> Result<(), SupervisorError> {
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
fn stop_after_exit_before_readiness(
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

fn teardown_error(error: std::io::Error) -> SupervisorError {
    SupervisorError::new(
        FailureKind::Crash,
        format!("could not stop the owned sidecar process group: {error}"),
    )
}

/// Cleanup during ordinary unwinding remains the final fallback for the owned
/// process groups. Abrupt desktop death skips this destructor; each packaged
/// service instead observes EOF on its private owner-liveness reader. Neither
/// path adopts foreign processes.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs::OpenOptions;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    static MCP_TEST_LOCK: Mutex<()> = Mutex::new(());
    static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn health_probe_accepts_compact_json() {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";

        assert!(backend_health_response_is_healthy(response));
    }

    #[test]
    fn health_probe_rejects_false_or_non_success_responses() {
        let unhealthy = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":false}";
        let failed = "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";

        assert!(!backend_health_response_is_healthy(unhealthy));
        assert!(!backend_health_response_is_healthy(failed));
    }

    fn stub_table(mode: &str, environment: Vec<(OsString, OsString)>) -> CommandTable {
        stub_table_at(
            mode,
            environment,
            unique_temp_path("supervisor-sidecar.log"),
        )
    }

    fn stub_table_at(
        mode: &str,
        mut environment: Vec<(OsString, OsString)>,
        log_path: PathBuf,
    ) -> CommandTable {
        environment.push((OsString::from("MUXED_STUB_MODE"), OsString::from(mode)));
        CommandTable::contract_stub(
            env::current_exe().expect("test executable"),
            vec![
                OsString::from("--exact"),
                OsString::from("supervisor::tests::stub_sidecar"),
                OsString::from("--nocapture"),
            ],
            environment,
            log_path,
        )
    }

    fn stub_table_with_mcp() -> CommandTable {
        let mut table = stub_table("ready-with-mcp", vec![]);
        table.mcp = Some(BackendCommand {
            program: env::current_exe().expect("test executable"),
            fixed_arguments: vec![
                OsString::from("--exact"),
                OsString::from("supervisor::tests::stub_sidecar"),
                OsString::from("--nocapture"),
            ],
            environment: vec![(
                OsString::from("MUXED_STUB_MODE"),
                OsString::from("mcp-ready"),
            )],
            pass_port_argument: false,
            requires_owner_liveness: false,
        });
        table
    }

    #[test]
    fn packaged_mcp_observes_desktop_owner_liveness() {
        let data_dir = unique_temp_path("packaged-mcp-owner-liveness");
        let table = CommandTable::packaged_services(
            env::current_exe().expect("test executable"),
            &data_dir,
            "tauri://localhost",
        )
        .expect("packaged command table");

        assert!(
            table.mcp.expect("MCP command").requires_owner_liveness,
            "abrupt desktop death must not leave an MCP process on the public port"
        );
    }

    fn fast_options() -> SupervisorOptions {
        SupervisorOptions {
            readiness_timeout: Duration::from_millis(300),
            shutdown_grace: Duration::from_millis(80),
            bind_retry_timeout: Duration::from_millis(100),
            bind_retry_interval: Duration::from_millis(10),
            liveness_probe_interval: Duration::from_millis(20),
            liveness_probe_timeout: Duration::from_millis(20),
            liveness_failure_threshold: 3,
            restart_limit: 1,
            restart_backoff: vec![Duration::ZERO],
            healthy_reset_interval: Duration::from_secs(1),
            log_limit_bytes: 512,
            sidecar_log_limit_bytes: 512,
            sidecar_log_generations: 3,
            port_candidates: vec![0],
            mcp_port_candidates: vec![0],
            mcp_required: true,
        }
    }

    fn production_mcp_options() -> SupervisorOptions {
        let mut options = fast_options();
        options.mcp_port_candidates.clear();
        options
    }

    #[test]
    fn contract_atomically_replaces_the_persisted_mcp_port() {
        let path = unique_temp_path("supervisor-mcp-port");

        persist_mcp_port_atomically(&path, 43_219).expect("persist first MCP port");
        persist_mcp_port_atomically(&path, 43_220).expect("replace MCP port");

        assert_eq!(read_persisted_mcp_port(&path), Some(43_220));
        assert_eq!(
            fs::read_dir(path.parent().expect("temporary parent"))
                .expect("read temporary parent")
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".supervisor-mcp-port")
                })
                .count(),
            0
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&path)
                .expect("persisted MCP port metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_file(path).expect("remove persisted MCP port");
    }

    /// A bounded wait that reports rather than requires: for a fact whose
    /// absence is the assertion's own business.
    fn until_or_timeout(mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !predicate() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn until(mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !predicate() {
            assert!(Instant::now() < deadline, "condition did not become true");
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// The operating system's own view of one process: `None` once it is gone,
    /// and a state beginning with `Z` while it lingers unreaped.  Reading it
    /// from outside the supervisor keeps the reaping contract observable
    /// without giving the supervisor a process-identifier accessor.
    #[cfg(unix)]
    fn process_state(pid: u32) -> Option<String> {
        let output = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .expect("inspect the process table");
        let state = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        (!state.is_empty()).then_some(state)
    }

    /// Records that this process was asked to stop cooperatively, then exits.
    ///
    /// The record is written from the signal handler itself, so it can only
    /// exist if SIGTERM was actually delivered and honoured.  Both calls are
    /// async-signal-safe; the descriptor is opened before the handler is armed.
    #[cfg(unix)]
    fn record_cooperative_exit_on_term(path: &Path) {
        use std::os::unix::ffi::OsStrExt;
        use std::sync::atomic::AtomicI32;

        static RECORD: AtomicI32 = AtomicI32::new(-1);

        extern "C" fn on_term(_signal: i32) {
            let descriptor = RECORD.load(Ordering::Relaxed);
            if descriptor >= 0 {
                let note = b"stopped-cooperatively";
                unsafe { libc::write(descriptor, note.as_ptr().cast(), note.len()) };
            }
            unsafe { libc::_exit(0) }
        }

        let mut c_path = path.as_os_str().as_bytes().to_vec();
        c_path.push(0);
        let descriptor = unsafe {
            libc::open(
                c_path.as_ptr().cast(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC,
                0o600 as libc::c_int,
            )
        };
        assert!(descriptor >= 0, "open the cooperative-exit record");
        RECORD.store(descriptor, Ordering::Relaxed);
        unsafe { libc::signal(libc::SIGTERM, on_term as *const () as libc::sighandler_t) };
    }

    #[test]
    fn contract_allows_packaged_cold_start_before_readiness_timeout() {
        assert_eq!(
            SupervisorOptions::default().readiness_timeout,
            Duration::from_secs(30)
        );
    }

    #[test]
    fn contract_normal_start_and_quit() {
        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), fast_options());
        supervisor.launch().expect("starts normally");
        assert!(supervisor.port().is_some());
        supervisor.shutdown().expect("shuts down normally");
        let events = supervisor.events();
        assert!(events
            .iter()
            .any(|event| matches!(event, SupervisorEvent::Ready { .. })));
        assert!(
            events.iter().any(|event| matches!(
                event,
                SupervisorEvent::ShutdownTermRequested { service } if service == "backend"
            )),
            "a cooperative backend is asked to stop before anything is forced"
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, SupervisorEvent::ShutdownKillRequested { .. })),
            "a cooperative backend exits within its grace period without escalation"
        );
        assert!(supervisor.running.is_none() && supervisor.running_mcp.is_none());
    }

    #[test]
    fn contract_shutdown_without_mcp_is_idempotent() {
        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), fast_options());
        supervisor.launch().expect("starts normally");
        supervisor.shutdown().expect("first shutdown");
        let after_first = supervisor.events().len();

        supervisor
            .shutdown()
            .expect("a second shutdown owns no handle and signals nothing");

        assert_eq!(
            supervisor.events().len(),
            after_first,
            "a repeated shutdown must not signal anything"
        );
    }

    #[test]
    fn contract_packaged_services_remove_pyinstaller_parent_state() {
        let contaminated = PYINSTALLER_PARENT_ENV
            .into_iter()
            .map(|name| (OsString::from(name), OsString::from("/deleted/_MEI-parent")))
            .collect::<Vec<_>>();
        let mut table = stub_table_with_mcp();
        table.backend.environment.extend(contaminated.clone());
        table
            .mcp
            .as_mut()
            .expect("MCP command")
            .environment
            .extend(contaminated);
        let mut supervisor = Supervisor::new(table, fast_options());

        supervisor
            .launch()
            .expect("packaged services ignore stale parent bootloader state");
        supervisor.shutdown().expect("packaged services stop");
    }

    #[test]
    fn contract_starts_mcp_on_an_ephemeral_port_and_injects_its_url() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let mut supervisor = Supervisor::new(stub_table_with_mcp(), fast_options());

        supervisor.launch().expect("packaged services start");

        let mcp_port = supervisor.mcp_port().expect("MCP port");
        assert_ne!(supervisor.port(), supervisor.mcp_port());
        assert!(supervisor
            .logs()
            .iter()
            .any(|line| line == &format!("stub-mcp-url=http://127.0.0.1:{mcp_port}/mcp")));
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::Ready { service, .. } if service == "mcp"
        )));
        supervisor.shutdown().expect("packaged services stop");
    }

    #[test]
    fn contract_retries_an_occupied_mcp_loopback_port() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve MCP port");
        let blocked_port = occupied.local_addr().expect("address").port();
        let mut options = fast_options();
        options.mcp_port_candidates = vec![blocked_port, 0];
        let mut supervisor = Supervisor::new(stub_table_with_mcp(), options);

        supervisor.launch().expect("retries MCP port");
        assert_ne!(supervisor.mcp_port(), Some(blocked_port));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_optional_mcp_bind_failure_keeps_the_backend_ready() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve MCP port");
        let blocked_port = occupied.local_addr().expect("address").port();
        let mut options = fast_options();
        options.mcp_port_candidates = vec![blocked_port];
        options.mcp_required = false;
        let mut table = stub_table_with_mcp();
        table.backend.environment = vec![(
            OsString::from("MUXED_STUB_MODE"),
            OsString::from("ready-reporting-mcp-absence"),
        )];
        let mut supervisor = Supervisor::new(table, options);

        supervisor
            .launch()
            .expect("optional MCP collision must not block the backend");

        assert!(supervisor.port().is_some());
        assert_eq!(supervisor.mcp_port(), None);
        // The backend must be told there is no MCP endpoint, so it launches
        // agents without one instead of falling back to the default port that
        // the install we just collided with is holding.
        assert!(supervisor
            .logs()
            .iter()
            .any(|line| line == "stub-mcp-unavailable=1"));
        assert!(supervisor.logs().iter().any(|line| line == "stub-mcp-url="));
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::Failed {
                service,
                kind: FailureKind::Bind,
                ..
            } if service == "mcp"
        )));
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::Ready { service, .. } if service == "backend"
        )));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_persists_and_reuses_the_mcp_port_with_the_same_injected_url() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let table = stub_table_with_mcp();
        let port_path = table.mcp_port_path.clone();
        let mut first = Supervisor::new(table.clone(), production_mcp_options());

        first.launch().expect("first packaged launch");
        let selected_port = first.mcp_port().expect("first MCP port");
        assert_eq!(
            fs::read_to_string(&port_path)
                .expect("persisted MCP port")
                .trim(),
            selected_port.to_string()
        );
        first.shutdown().expect("first shutdown");

        let mut fresh = Supervisor::new(table, production_mcp_options());
        fresh.launch().expect("fresh supervisor launch");

        assert_eq!(fresh.mcp_port(), Some(selected_port));
        assert!(fresh
            .logs()
            .iter()
            .any(|line| { line == &format!("stub-mcp-url=http://127.0.0.1:{selected_port}/mcp") }));
        assert!(!fresh
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::McpPortRollover { .. })));
        fresh.shutdown().expect("fresh supervisor shutdown");
        let _ = fs::remove_file(port_path);
    }

    #[test]
    fn contract_rolls_over_an_occupied_persisted_mcp_port_after_readiness() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let occupied = TcpListener::bind("127.0.0.1:0").expect("occupy persisted port");
        let previous_port = occupied.local_addr().expect("occupied address").port();
        let table = stub_table_with_mcp();
        persist_mcp_port_atomically(&table.mcp_port_path, previous_port)
            .expect("seed persisted MCP port");
        let mut supervisor = Supervisor::new(table.clone(), production_mcp_options());

        supervisor.launch().expect("collision falls back");

        let active_port = supervisor.mcp_port().expect("fallback MCP port");
        assert_ne!(active_port, previous_port);
        assert_eq!(
            read_persisted_mcp_port(&table.mcp_port_path),
            Some(active_port)
        );
        let rollover_facts = supervisor
            .events()
            .into_iter()
            .filter(|event| {
                matches!(
                    event,
                    SupervisorEvent::McpPortRollover {
                        previous_port: actual_previous,
                        active_port: actual_active,
                    } if *actual_previous == previous_port && *actual_active == active_port
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(rollover_facts.len(), 1);
        let serialized = serde_json::to_string(&rollover_facts[0]).expect("serialize fact");
        assert_eq!(
            serialized,
            format!(
                r#"{{"type":"mcp_port_rollover","previous_port":{previous_port},"active_port":{active_port}}}"#
            )
        );
        assert!(!serialized.contains(supervisor.credential()));
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(table.mcp_port_path);
    }

    #[test]
    fn contract_failed_fallback_keeps_the_previous_persisted_mcp_port() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let occupied = TcpListener::bind("127.0.0.1:0").expect("occupy persisted port");
        let previous_port = occupied.local_addr().expect("occupied address").port();
        let mut table = stub_table_with_mcp();
        persist_mcp_port_atomically(&table.mcp_port_path, previous_port)
            .expect("seed persisted MCP port");
        table.mcp.as_mut().expect("MCP command").environment = vec![(
            OsString::from("MUXED_STUB_MODE"),
            OsString::from("mcp-exits"),
        )];
        let mut supervisor = Supervisor::new(table.clone(), production_mcp_options());

        supervisor
            .launch()
            .expect_err("failed MCP readiness must fail fallback");

        assert_eq!(
            read_persisted_mcp_port(&table.mcp_port_path),
            Some(previous_port)
        );
        assert!(!supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::McpPortRollover { .. })));
        let _ = fs::remove_file(table.mcp_port_path);
    }

    #[test]
    fn contract_explicit_mcp_port_is_authoritative_and_does_not_replace_persistence() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let table = stub_table_with_mcp();
        let previous_port = select_loopback_port(&[]).expect("previous persisted port");
        persist_mcp_port_atomically(&table.mcp_port_path, previous_port)
            .expect("seed persisted MCP port");
        let explicit_port = select_loopback_port(&[]).expect("explicit MCP port");
        assert_ne!(explicit_port, previous_port);
        let mut options = fast_options();
        options.mcp_port_candidates = vec![explicit_port];
        let mut supervisor = Supervisor::new(table.clone(), options);

        supervisor.launch().expect("explicit MCP launch");

        assert_eq!(supervisor.mcp_port(), Some(explicit_port));
        assert_eq!(
            read_persisted_mcp_port(&table.mcp_port_path),
            Some(previous_port)
        );
        assert!(!supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::McpPortRollover { .. })));
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(table.mcp_port_path);
    }

    #[test]
    fn contract_attributes_mcp_startup_failure_to_mcp() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let mut table = stub_table_with_mcp();
        table.mcp.as_mut().expect("MCP command").environment = vec![(
            OsString::from("MUXED_STUB_MODE"),
            OsString::from("mcp-exits"),
        )];
        let error = Supervisor::new(table, fast_options())
            .launch()
            .expect_err("MCP startup failure must fail launch");

        assert_eq!(error.kind, FailureKind::Crash);
        assert_eq!(error.service, "mcp");
    }

    #[test]
    fn contract_mints_a_new_credential_for_each_launch() {
        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), fast_options());
        supervisor.launch().expect("first launch");
        let first = supervisor.credential.clone();
        supervisor.shutdown().expect("first shutdown");
        supervisor.launch().expect("second launch");
        assert_ne!(supervisor.credential, first);
        supervisor.shutdown().expect("second shutdown");
    }

    #[test]
    fn contract_retries_an_occupied_loopback_port() {
        let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve port");
        let blocked_port = occupied.local_addr().expect("address").port();
        let mut options = fast_options();
        options.port_candidates = vec![blocked_port, 0];
        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), options);
        supervisor.launch().expect("retries port");
        assert_ne!(supervisor.port(), Some(blocked_port));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_reports_persistent_bind_failure() {
        let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve port");
        let mut options = fast_options();
        options.port_candidates = vec![occupied.local_addr().expect("address").port()];
        let error = Supervisor::new(stub_table("ready", vec![]), options)
            .launch()
            .expect_err("must fail bind");
        assert_eq!(error.kind, FailureKind::Bind);
    }

    #[test]
    fn contract_reports_bad_credential_without_leaking_it() {
        let mut supervisor = Supervisor::new(
            stub_table(
                "auth",
                vec![(
                    OsString::from("MUXED_STUB_EXPECTED_CREDENTIAL"),
                    OsString::from("wrong"),
                )],
            ),
            fast_options(),
        );
        let error = supervisor.launch().expect_err("authentication failure");
        let secret = supervisor.credential.clone();
        assert_eq!(error.kind, FailureKind::Authentication);
        assert!(supervisor.logs().join("\n").contains("[REDACTED]"));
        assert!(!format!("{:?}", supervisor.events()).contains(&secret));
    }

    #[test]
    fn contract_reports_readiness_timeout() {
        let mut options = fast_options();
        options.readiness_timeout = Duration::from_millis(80);
        let error = Supervisor::new(stub_table("no-ready", vec![]), options)
            .launch()
            .expect_err("must time out");
        assert_eq!(error.kind, FailureKind::ReadinessTimeout);
    }

    #[test]
    fn readiness_terminal_drain_never_accepts_ready_after_exit() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(format!("{READINESS_PREFIX}43210"))
            .expect("send buffered readiness");
        drop(sender);

        assert_eq!(
            drain_control_failures(&receiver, 43210, Duration::from_millis(20)),
            None
        );
    }

    #[test]
    fn contract_reports_migration_failure() {
        let mut supervisor = Supervisor::new(stub_table("migration", vec![]), fast_options());
        let error = supervisor.launch().expect_err("migration fails");
        assert_eq!(error.kind, FailureKind::Migration);
        assert_eq!(supervisor.restarts, 0);
        assert!(supervisor.port().is_none());
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::Failed {
                kind: FailureKind::Migration,
                ..
            }
        )));
    }

    #[test]
    fn contract_prioritizes_migration_failure_over_sidecar_log_failure() {
        let unwritable_log = unique_temp_path("supervisor-unwritable-log");
        fs::create_dir_all(&unwritable_log).expect("create directory at log path");
        let mut supervisor = Supervisor::new(stub_table("migration", vec![]), fast_options());
        supervisor.logs.lock().expect("logs lock").disk.path = unwritable_log.clone();

        let error = supervisor
            .launch()
            .expect_err("migration failure remains authoritative");

        assert_eq!(error.kind, FailureKind::Migration);
        assert!(supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::SidecarLogUnavailable { .. })));
        fs::remove_dir_all(unwritable_log).expect("remove unwritable log directory");
    }

    #[test]
    fn contract_reports_sidecar_log_failure_without_stopping_the_backend() {
        let unwritable_log = unique_temp_path("supervisor-unwritable-poll-log");
        fs::create_dir_all(&unwritable_log).expect("create directory at log path");
        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), fast_options());
        supervisor.launch().expect("backend becomes ready");
        let port = supervisor.port();
        {
            let mut logs = supervisor.logs.lock().expect("logs lock");
            logs.disk.path = unwritable_log.clone();
            logs.push_redacted("first failed disk write".to_owned());
        }

        supervisor.poll().expect("disk log failure is non-fatal");
        {
            supervisor
                .logs
                .lock()
                .expect("logs lock")
                .push_redacted("same failed disk write".to_owned());
        }
        supervisor
            .poll()
            .expect("duplicate disk error remains non-fatal");

        assert_eq!(supervisor.port(), port);
        assert_eq!(
            supervisor
                .events()
                .iter()
                .filter(|event| matches!(event, SupervisorEvent::SidecarLogUnavailable { .. }))
                .count(),
            1
        );
        supervisor.shutdown().expect("shutdown");
        fs::remove_dir_all(unwritable_log).expect("remove unwritable log directory");
    }

    #[test]
    fn contract_migration_failure_during_recovery_is_terminal() {
        let marker = unique_temp_path("supervisor-migration");
        let mut options = fast_options();
        options.restart_limit = 5;
        options.restart_backoff = vec![Duration::ZERO; 5];
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-then-migration",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            options,
        );

        supervisor.launch().expect("first child becomes ready");
        let error = loop {
            match supervisor.poll() {
                Ok(()) => thread::sleep(Duration::from_millis(5)),
                Err(error) => break error,
            }
        };

        assert_eq!(error.kind, FailureKind::Migration);
        assert_eq!(error.message, "database could not be migrated");
        assert_eq!(restarting_attempts(&supervisor), vec![1]);
        assert_eq!(supervisor.restarts, 1);
        assert!(supervisor.port().is_none());
        assert!(supervisor.next_recovery.is_none());
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_restarts_an_unexpected_child_crash() {
        let marker = unique_temp_path("supervisor-restart");
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-then-crash-once",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            fast_options(),
        );
        supervisor.launch().expect("first child becomes ready");
        until(|| {
            supervisor.poll().expect("restart succeeds");
            supervisor
                .events()
                .iter()
                .any(|event| matches!(event, SupervisorEvent::Restarting { .. }))
        });
        assert!(supervisor.port().is_some());
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_backs_off_without_blocking_poll() {
        let mut options = fast_options();
        options.restart_limit = 3;
        options.restart_backoff = vec![
            Duration::ZERO,
            Duration::from_millis(80),
            Duration::from_millis(160),
        ];
        let mut supervisor =
            Supervisor::new(stub_table("ready-then-crash-always", vec![]), options);

        supervisor.launch().expect("first child becomes ready");
        until(|| {
            supervisor.poll().expect("first recovery succeeds");
            restarting_attempts(&supervisor).len() == 1
        });
        until(|| {
            supervisor.poll().expect("backoff is pending");
            supervisor
                .events()
                .iter()
                .filter(|event| matches!(event, SupervisorEvent::Exited { .. }))
                .count()
                == 2
        });

        let backoff_started = Instant::now();
        let poll_started = Instant::now();
        supervisor.poll().expect("poll returns during backoff");
        assert!(
            poll_started.elapsed() < Duration::from_millis(20),
            "poll slept while backoff was pending"
        );
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::RecoveryQueued { service } if service == "backend"
        )));
        thread::sleep(Duration::from_millis(35));
        supervisor.poll().expect("backoff remains pending");
        assert_eq!(restarting_attempts(&supervisor), vec![1]);

        until(|| {
            supervisor.poll().expect("second recovery succeeds");
            restarting_attempts(&supervisor).len() == 2
        });
        assert!(backoff_started.elapsed() >= Duration::from_millis(80));
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2]);

        until(|| {
            supervisor.poll().expect("second backoff is pending");
            supervisor
                .events()
                .iter()
                .filter(|event| matches!(event, SupervisorEvent::Exited { .. }))
                .count()
                == 3
        });
        let second_backoff_started = Instant::now();
        thread::sleep(Duration::from_millis(90));
        supervisor.poll().expect("growing backoff remains pending");
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2]);
        until(|| {
            supervisor.poll().expect("third recovery succeeds");
            restarting_attempts(&supervisor).len() == 3
        });
        assert!(second_backoff_started.elapsed() >= Duration::from_millis(160));
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2, 3]);
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_gives_up_after_five_attempts_without_farming_resets() {
        let mut options = fast_options();
        options.restart_limit = 5;
        options.restart_backoff = vec![Duration::ZERO; 5];
        options.healthy_reset_interval = Duration::from_millis(100);
        let mut supervisor =
            Supervisor::new(stub_table("ready-then-crash-always", vec![]), options);

        supervisor.launch().expect("first child becomes ready");
        let error = loop {
            match supervisor.poll() {
                Ok(()) => thread::sleep(Duration::from_millis(5)),
                Err(error) => break error,
            }
        };

        assert_eq!(error.kind, FailureKind::Crash);
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn contract_explicit_retry_restores_the_full_allowance_after_give_up() {
        let marker = unique_temp_path("supervisor-explicit-retry");
        let mut options = fast_options();
        options.restart_limit = 2;
        options.restart_backoff = vec![Duration::ZERO; 2];
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-then-crash-until-marker",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            options,
        );

        supervisor.launch().expect("first child becomes ready");
        let credential = supervisor.credential().to_owned();
        let port = supervisor.port();
        loop {
            if supervisor.poll().is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2]);
        assert!(supervisor.port().is_none());

        fs::write(&marker, b"cause resolved").expect("resolve transient cause");
        supervisor.retry().expect("explicit retry succeeds");

        assert_eq!(supervisor.credential(), credential);
        assert_eq!(supervisor.port(), port);
        fs::remove_file(&marker).expect("reintroduce transient cause");
        loop {
            if supervisor.poll().is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(restarting_attempts(&supervisor), vec![1, 2, 1, 2]);
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_restores_the_budget_after_continuous_health() {
        let marker = unique_temp_path("supervisor-budget-reset");
        let mut options = fast_options();
        options.restart_limit = 2;
        options.restart_backoff = vec![Duration::ZERO, Duration::from_millis(200)];
        options.healthy_reset_interval = Duration::from_millis(60);
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-crash-reset-sequence",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            options,
        );

        supervisor.launch().expect("first child becomes ready");
        until(|| {
            supervisor.poll().expect("recoveries succeed");
            restarting_attempts(&supervisor).len() == 2
        });

        assert_eq!(restarting_attempts(&supervisor), vec![1, 1]);
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_recovers_the_pair_on_its_pinned_ports_after_backend_exit() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let marker = unique_temp_path("supervisor-paired-backend-recovery");
        let mut table = stub_table(
            "ready-with-mcp-then-crash-once",
            vec![(
                OsString::from("MUXED_STUB_MARKER"),
                marker.clone().into_os_string(),
            )],
        );
        table.mcp = stub_table_with_mcp().mcp;
        let mut supervisor = Supervisor::new(table, fast_options());

        supervisor.launch().expect("pair starts");
        let backend_port = supervisor.port().expect("backend port");
        let mcp_port = supervisor.mcp_port().expect("MCP port");
        let credential = supervisor.credential().to_owned();
        until(|| {
            supervisor.poll().expect("paired recovery succeeds");
            supervisor
                .events()
                .iter()
                .filter(|event| {
                    matches!(
                        event,
                        SupervisorEvent::Ready { service, .. } if service == "mcp"
                    )
                })
                .count()
                == 2
        });

        assert_eq!(supervisor.port(), Some(backend_port));
        assert_eq!(supervisor.mcp_port(), Some(mcp_port));
        assert_eq!(supervisor.credential(), credential);
        assert!(!supervisor.logs().join("\n").contains(&credential));
        assert!(supervisor.logs().join("\n").contains("[REDACTED]"));
        for service in ["backend", "mcp"] {
            assert!(supervisor.events().iter().any(|event| matches!(
                event,
                SupervisorEvent::Restarting { service: actual, attempt: 1 }
                    if actual == service
            )));
        }
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_reports_a_pinned_port_bind_failure_without_relocating() {
        let marker = unique_temp_path("supervisor-pinned-bind-failure");
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-then-crash-once",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            fast_options(),
        );
        supervisor.launch().expect("backend starts");
        let pinned_port = supervisor.port().expect("pinned backend port");
        let deadline = Instant::now() + Duration::from_secs(1);
        let _occupied = loop {
            if let Ok(listener) = TcpListener::bind(("127.0.0.1", pinned_port)) {
                break listener;
            }
            assert!(
                Instant::now() < deadline,
                "crashed stub did not release its pinned port"
            );
            thread::sleep(Duration::from_millis(5));
        };

        let error = loop {
            match supervisor.poll() {
                Ok(()) => thread::sleep(Duration::from_millis(10)),
                Err(error) => break error,
            }
        };

        assert_eq!(error.kind, FailureKind::Bind);
        assert!(error.message.contains(&pinned_port.to_string()));
        assert_eq!(supervisor.port(), None);
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_recovers_the_pair_on_its_pinned_ports_after_mcp_exit() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let marker = unique_temp_path("supervisor-paired-mcp-recovery");
        let mut table = stub_table_with_mcp();
        table.mcp.as_mut().expect("MCP command").environment = vec![
            (
                OsString::from("MUXED_STUB_MODE"),
                OsString::from("mcp-ready-then-crash-once"),
            ),
            (
                OsString::from("MUXED_STUB_MARKER"),
                marker.clone().into_os_string(),
            ),
        ];
        let mut supervisor = Supervisor::new(table, fast_options());

        supervisor.launch().expect("pair starts");
        let backend_port = supervisor.port().expect("backend port");
        let mcp_port = supervisor.mcp_port().expect("MCP port");
        let credential = supervisor.credential().to_owned();
        until(|| {
            supervisor.poll().expect("paired recovery succeeds");
            supervisor
                .events()
                .iter()
                .filter(|event| {
                    matches!(
                        event,
                        SupervisorEvent::Ready { service, .. } if service == "backend"
                    )
                })
                .count()
                == 2
        });

        assert_eq!(supervisor.port(), Some(backend_port));
        assert_eq!(supervisor.mcp_port(), Some(mcp_port));
        assert_eq!(supervisor.credential(), credential);
        assert!(!supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::McpPortRollover { .. })));
        for service in ["backend", "mcp"] {
            assert!(supervisor.events().iter().any(|event| matches!(
                event,
                SupervisorEvent::Restarting { service: actual, attempt: 1 }
                    if actual == service
            )));
        }
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_recovers_the_pair_when_the_backend_stays_alive_but_stops_serving() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let marker = unique_temp_path("supervisor-wedged-backend");
        let mut table = stub_table(
            "ready-then-wedge-once",
            vec![(
                OsString::from("MUXED_STUB_MARKER"),
                marker.clone().into_os_string(),
            )],
        );
        table.mcp = stub_table_with_mcp().mcp;
        let mut supervisor = Supervisor::new(table, fast_options());

        supervisor.launch().expect("pair starts");
        let backend_port = supervisor.port().expect("backend port");
        let mcp_port = supervisor.mcp_port().expect("MCP port");
        until(|| {
            supervisor.poll().expect("wedged pair recovers");
            supervisor
                .events()
                .iter()
                .filter(|event| {
                    matches!(
                        event,
                        SupervisorEvent::Ready { service, .. } if service == "backend"
                    )
                })
                .count()
                == 2
        });

        assert_eq!(supervisor.port(), Some(backend_port));
        assert_eq!(supervisor.mcp_port(), Some(mcp_port));
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::ShutdownTermRequested { service } if service == "backend"
        )));
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_keeps_a_backend_running_when_successes_break_up_probe_failures() {
        let mut options = fast_options();
        options.liveness_probe_interval = Duration::from_millis(15);
        options.liveness_probe_timeout = Duration::from_millis(15);
        options.liveness_failure_threshold = 3;
        let mut supervisor = Supervisor::new(stub_table("health-failures-reset", vec![]), options);

        supervisor.launch().expect("backend becomes ready");
        let original_port = supervisor.port();
        let deadline = Instant::now() + Duration::from_millis(180);
        while Instant::now() < deadline {
            supervisor.poll().expect("backend remains supervised");
            thread::sleep(Duration::from_millis(5));
        }

        assert_eq!(supervisor.port(), original_port);
        assert!(!supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::Restarting { .. })));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_accepts_a_slow_health_response_that_arrives_within_the_timeout() {
        let mut options = fast_options();
        options.liveness_probe_interval = Duration::from_millis(10);
        options.liveness_probe_timeout = Duration::from_millis(80);
        options.liveness_failure_threshold = 1;
        let mut supervisor = Supervisor::new(stub_table("health-slow", vec![]), options);

        supervisor.launch().expect("backend becomes ready");
        let original_port = supervisor.port();
        let deadline = Instant::now() + Duration::from_millis(180);
        while Instant::now() < deadline {
            supervisor.poll().expect("slow responses stay healthy");
            thread::sleep(Duration::from_millis(5));
        }

        assert_eq!(supervisor.port(), original_port);
        assert!(!supervisor
            .events()
            .iter()
            .any(|event| matches!(event, SupervisorEvent::Restarting { .. })));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_poll_does_not_wait_for_an_in_flight_probe() {
        let marker = unique_temp_path("supervisor-probe-in-flight");
        let mut options = fast_options();
        options.liveness_probe_interval = Duration::from_millis(10);
        options.liveness_probe_timeout = Duration::from_millis(200);
        let mut supervisor = Supervisor::new(
            stub_table(
                "health-probe-in-flight",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            options,
        );

        supervisor.launch().expect("backend becomes ready");
        until(|| marker.exists());
        let started = Instant::now();
        supervisor.poll().expect("poll remains responsive");
        assert!(
            started.elapsed() < Duration::from_millis(40),
            "poll waited for the network probe"
        );
        supervisor.shutdown().expect("shutdown");
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn contract_does_not_probe_until_the_backend_reports_ready() {
        let marker = unique_temp_path("supervisor-probed-before-ready");
        let mut options = fast_options();
        options.liveness_probe_interval = Duration::from_millis(1);
        options.liveness_probe_timeout = Duration::from_millis(20);
        options.liveness_failure_threshold = 1;
        let mut supervisor = Supervisor::new(
            stub_table(
                "health-delayed-ready",
                vec![(
                    OsString::from("MUXED_STUB_MARKER"),
                    marker.clone().into_os_string(),
                )],
            ),
            options,
        );

        supervisor.launch().expect("slow startup reaches readiness");

        assert!(!marker.exists(), "backend was probed before readiness");
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn contract_escalates_to_forced_kill_for_an_uncooperative_child() {
        let mut supervisor = Supervisor::new(stub_table("ignore-term", vec![]), fast_options());
        supervisor.launch().expect("starts");
        supervisor.shutdown().expect("kills after grace");
        let events = supervisor.events();
        let term_requested = events.iter().position(|event| {
            matches!(event, SupervisorEvent::ShutdownTermRequested { service } if service == "backend")
        });
        let kill_requested = events.iter().position(|event| {
            matches!(event, SupervisorEvent::ShutdownKillRequested { service } if service == "backend")
        });

        assert!(
            term_requested < kill_requested && kill_requested.is_some(),
            "escalation must follow a bounded wait on the cooperative request"
        );
        assert!(supervisor.running.is_none());
    }

    /// The identifier a stub descendant records once it is up, if it is there
    /// yet.  Waiting on the record is how a caller knows the worker exists
    /// before the process that spawned it goes away.
    #[cfg(unix)]
    fn recorded_pid_if_any(path: &Path) -> Option<u32> {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
    }

    #[cfg(unix)]
    fn recorded_pid(path: &Path) -> u32 {
        recorded_pid_if_any(path).expect("the descendant recorded its identifier")
    }

    /// What a stub worker wrote when it honoured a cooperative stop request.
    /// Absent when it was only ever forced out.
    #[cfg(unix)]
    fn cooperative_stop_record(pid_path: &Path) -> Option<String> {
        let record = format!("{}.stop", pid_path.display());
        until_or_timeout(|| fs::metadata(&record).is_ok());
        fs::read_to_string(&record)
            .ok()
            .map(|text| text.trim().to_owned())
    }

    #[cfg(unix)]
    fn remove_descendant_records(pid_path: &Path) {
        let _ = fs::remove_file(format!("{}.stop", pid_path.display()));
        let _ = fs::remove_file(pid_path);
    }

    /// A reserved-then-released loopback port, for a descendant to take over.
    #[cfg(unix)]
    fn free_loopback_port() -> u16 {
        let reservation = TcpListener::bind("127.0.0.1:0").expect("reserve a loopback port");
        let port = reservation.local_addr().expect("reserved address").port();
        drop(reservation);
        port
    }

    #[cfg(unix)]
    fn descendant_table(descendant_port: u16, extra: Vec<(OsString, OsString)>) -> CommandTable {
        let mut environment = vec![(
            OsString::from("MUXED_STUB_DESCENDANT_PORT"),
            OsString::from(descendant_port.to_string()),
        )];
        environment.extend(extra);
        stub_table("ready-with-descendant", environment)
    }

    /// One teardown against a real PyInstaller-shaped process tree: the direct
    /// child stops on the cooperative request while its descendant has to be
    /// forced out, and neither the descendant's loopback resource nor the
    /// direct child's process-table entry may survive the shutdown.
    #[cfg(unix)]
    #[test]
    fn shutdown_ends_a_descendant_tree_by_both_exit_paths() {
        let descendant_port = free_loopback_port();
        let parent_pid_path = unique_temp_path("supervisor-descendant-parent-pid");
        let parent_exit_path = unique_temp_path("supervisor-descendant-parent-exit");
        let mut supervisor = Supervisor::new(
            descendant_table(
                descendant_port,
                vec![
                    (
                        OsString::from("MUXED_STUB_PARENT_PID_PATH"),
                        parent_pid_path.clone().into_os_string(),
                    ),
                    (
                        OsString::from("MUXED_STUB_PARENT_EXIT_PATH"),
                        parent_exit_path.clone().into_os_string(),
                    ),
                ],
            ),
            fast_options(),
        );

        supervisor.launch().expect("parent and descendant start");
        until(|| TcpStream::connect(("127.0.0.1", descendant_port)).is_ok());
        let direct_child_pid = fs::read_to_string(&parent_pid_path)
            .expect("the direct child recorded its identifier")
            .trim()
            .parse::<u32>()
            .expect("a numeric process identifier");

        supervisor
            .shutdown()
            .expect("the whole owned process group stops");

        assert_eq!(
            fs::read_to_string(&parent_exit_path).unwrap_or_default(),
            "stopped-cooperatively",
            "the direct child must stop on the cooperative request"
        );
        assert!(
            supervisor.events().iter().any(|event| matches!(
                event,
                SupervisorEvent::ShutdownKillRequested { service } if service == "backend"
            )),
            "the descendant that ignored the request must force an escalation"
        );
        assert_eq!(
            process_state(direct_child_pid),
            None,
            "the direct child was left unreaped"
        );
        until(|| TcpListener::bind(("127.0.0.1", descendant_port)).is_ok());
        let _ = fs::remove_file(parent_pid_path);
        let _ = fs::remove_file(parent_exit_path);
    }

    /// An unexpected exit is the one path that used to drop the owned handle
    /// instead of tearing the group down.  A direct child that exits says
    /// nothing about the rest of its group, so the surviving worker — and the
    /// loopback port it pins for the replacement spawn — must be released here,
    /// through the same owned teardown shutdown and recovery use.
    #[cfg(unix)]
    #[test]
    fn poll_ends_a_surviving_descendant_when_the_direct_child_exits() {
        let descendant_port = free_loopback_port();
        let marker = unique_temp_path("supervisor-poll-descendant-marker");
        let mut supervisor = Supervisor::new(
            stub_table(
                "ready-with-descendant-then-crash-once",
                vec![
                    (
                        OsString::from("MUXED_STUB_DESCENDANT_PORT"),
                        OsString::from(descendant_port.to_string()),
                    ),
                    (
                        OsString::from("MUXED_STUB_MARKER"),
                        marker.clone().into_os_string(),
                    ),
                ],
            ),
            fast_options(),
        );
        supervisor.launch().expect("parent and descendant start");
        until(|| TcpStream::connect(("127.0.0.1", descendant_port)).is_ok());

        until(|| {
            supervisor
                .poll()
                .expect("an unexpected exit queues recovery");
            supervisor.events().iter().any(|event| {
                matches!(event, SupervisorEvent::RecoveryQueued { service } if service == "backend")
            })
        });

        assert!(
            supervisor.events().iter().any(|event| matches!(
                event,
                SupervisorEvent::ShutdownKillRequested { service } if service == "backend"
            )),
            "the surviving descendant must force the owned teardown to escalate"
        );
        until(|| TcpListener::bind(("127.0.0.1", descendant_port)).is_ok());
        supervisor.shutdown().expect("stop the replacement sidecar");
        let _ = fs::remove_file(marker);
    }

    /// A failed launch ends the group it partially started, through the same
    /// ordered teardown a readiness timeout uses: the direct child exiting says
    /// nothing about the worker it handed off to, and that worker is asked to
    /// stop before anything forces it.  Dropping the handle would eventually
    /// force the group out, but only startup can afford it a graceful stop.
    #[cfg(unix)]
    #[test]
    fn a_backend_that_exits_before_readiness_stops_its_partially_started_group() {
        let descendant_pid_path = unique_temp_path("supervisor-startup-descendant-pid");
        let mut supervisor = Supervisor::new(
            stub_table(
                "exit-with-descendant",
                vec![(
                    OsString::from("MUXED_STUB_DESCENDANT_PID_PATH"),
                    descendant_pid_path.clone().into_os_string(),
                )],
            ),
            fast_options(),
        );

        let error = supervisor
            .launch()
            .expect_err("a backend that never reports readiness fails the launch");

        assert_eq!(error.kind, FailureKind::Crash);
        assert!(
            error.message.contains("exited before readiness"),
            "the exit status stays the reported diagnosis: {}",
            error.message
        );
        assert_eq!(
            cooperative_stop_record(&descendant_pid_path),
            Some("stopped-cooperatively".to_owned()),
            "the partially started worker was never asked to stop"
        );
        assert_eq!(
            process_state(recorded_pid(&descendant_pid_path)),
            None,
            "the partially started group outlived the failed launch"
        );
        remove_descendant_records(&descendant_pid_path);
    }

    /// The MCP service reaches the same startup failure by its own readiness
    /// path, and owes the same teardown of what its failed launch started.
    #[cfg(unix)]
    #[test]
    fn an_mcp_service_that_exits_before_readiness_stops_its_partially_started_group() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let descendant_pid_path = unique_temp_path("supervisor-startup-mcp-descendant-pid");
        let mut table = stub_table_with_mcp();
        let mcp_port_path = table.mcp_port_path.clone();
        table.mcp.as_mut().expect("MCP command").environment = vec![
            (
                OsString::from("MUXED_STUB_MODE"),
                OsString::from("mcp-exit-with-descendant"),
            ),
            (
                OsString::from("MUXED_STUB_DESCENDANT_PID_PATH"),
                descendant_pid_path.clone().into_os_string(),
            ),
        ];

        let error = Supervisor::new(table, fast_options())
            .launch()
            .expect_err("an MCP service that never initializes fails the launch");

        assert_eq!(error.kind, FailureKind::Crash);
        assert_eq!(error.service, "mcp");
        assert_eq!(
            cooperative_stop_record(&descendant_pid_path),
            Some("stopped-cooperatively".to_owned()),
            "the partially started MCP worker was never asked to stop"
        );
        assert_eq!(
            process_state(recorded_pid(&descendant_pid_path)),
            None,
            "the partially started MCP group outlived the failed launch"
        );
        remove_descendant_records(&descendant_pid_path);
        let _ = fs::remove_file(mcp_port_path);
    }

    /// The third startup path — a direct child that exits between emitting its
    /// readiness line and the supervisor observing it — cannot be pinned down
    /// from outside, because which of the two startup checks notices the exit
    /// first is a race.  All three paths report through this one operation, so
    /// the operation itself is held to tearing the group down first.
    #[cfg(unix)]
    #[test]
    fn reporting_an_exit_before_readiness_first_ends_the_rest_of_the_owned_group() {
        let pid_path = unique_temp_path("supervisor-exit-before-readiness-descendant-pid");
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(format!(
                "sh -c 'trap \"\" TERM; echo $$ > {}; sleep 30' & exit 7",
                pid_path.display()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut sidecar = OwnedSidecar::spawn(command).expect("spawn an owned sidecar");
        until(|| recorded_pid_if_any(&pid_path).is_some());
        let descendant_pid = recorded_pid(&pid_path);
        until(|| {
            sidecar
                .try_direct_child_exit()
                .expect("exit status is readable")
                .is_some()
        });
        let status = sidecar
            .try_direct_child_exit()
            .expect("exit status is readable")
            .expect("the direct child has exited");

        let error = stop_after_exit_before_readiness(&mut sidecar, "backend", status);

        assert_eq!(error.kind, FailureKind::Crash);
        assert_eq!(
            error.message, "backend exited before readiness with status Some(7)",
            "teardown must not displace the exit status the caller needs"
        );
        until(|| process_state(descendant_pid).is_none());
        let _ = fs::remove_file(pid_path);
    }

    /// Cleanup is best effort, not absent: a supervisor that simply leaves
    /// scope during ordinary unwinding still releases the group it owns.  Only
    /// an abrupt death of this process could skip it.
    #[cfg(unix)]
    #[test]
    fn a_supervisor_leaving_scope_releases_its_owned_group() {
        let descendant_port = free_loopback_port();

        {
            let mut supervisor =
                Supervisor::new(descendant_table(descendant_port, vec![]), fast_options());
            supervisor.launch().expect("parent and descendant start");
            until(|| TcpStream::connect(("127.0.0.1", descendant_port)).is_ok());
        }

        until(|| TcpListener::bind(("127.0.0.1", descendant_port)).is_ok());
    }

    /// Teardown reaches owned handles and nothing else.  Both sentinels share
    /// this test process's own group, so a teardown that reached beyond its
    /// handles would take them down too — and the second is deliberately shaped
    /// like whatever a process search would match: the same executable as the
    /// sidecar, holding a loopback port of its own.  Durable tmux sessions and
    /// terminal sessions sit outside the boundary for the same reason; that the
    /// containment layer names no such search at all is held by
    /// `owned_sidecar::tests::the_containment_boundary_never_searches_for_a_process_it_did_not_spawn`.
    #[cfg(unix)]
    #[test]
    fn shutdown_leaves_processes_this_supervisor_did_not_spawn_alone() {
        let mut unrelated = Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start a process this supervisor does not own");
        let sentinel_port = free_loopback_port();
        let mut sentinel_command = Command::new(env::current_exe().expect("test executable"));
        sentinel_command
            .args(["--exact", "supervisor::tests::stub_sidecar", "--nocapture"])
            .env("MUXED_STUB_MODE", "unrelated-sentinel")
            .env("MUXED_STUB_DESCENDANT_PORT", sentinel_port.to_string())
            .env("MUXED_BACKEND_PORT", "0")
            .env(CREDENTIAL_ENV, "unrelated-sentinel-credential")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // The sentinel is the only stub this test spawns directly rather than
        // through the supervisor, so the sanitisation every supervisor-launched
        // process gets has to be applied here too: `stub_sidecar` exits 39 on
        // inherited PyInstaller parent state, which a shell launched from the
        // packaged app always carries.
        sanitize_packaged_process_environment(&mut sentinel_command);
        let mut look_alike = sentinel_command
            .spawn()
            .expect("start a look-alike process this supervisor does not own");
        until(|| TcpStream::connect(("127.0.0.1", sentinel_port)).is_ok());

        let mut supervisor = Supervisor::new(stub_table("ready", vec![]), fast_options());
        supervisor.launch().expect("starts");

        supervisor.shutdown().expect("stops only its own sidecars");

        assert!(
            unrelated
                .try_wait()
                .expect("unrelated process is observable")
                .is_none(),
            "shutdown must not signal a process this supervisor did not spawn"
        );
        assert!(
            look_alike
                .try_wait()
                .expect("look-alike process is observable")
                .is_none(),
            "shutdown must not target a process by executable name"
        );
        assert!(
            TcpListener::bind(("127.0.0.1", sentinel_port)).is_err(),
            "shutdown must not target a process by the loopback port it holds"
        );
        for mut sentinel in [unrelated, look_alike] {
            sentinel.kill().expect("stop the sentinel");
            sentinel.wait().expect("reap the sentinel");
        }
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_still_stops_backend_after_mcp_stop_failure() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let mut supervisor = Supervisor::new(stub_table_with_mcp(), fast_options());
        supervisor.launch().expect("packaged services start");
        let mcp = supervisor.running_mcp.as_mut().expect("owned MCP child");
        mcp.sidecar
            .terminate_and_reap()
            .expect("stop and reap MCP before shutdown");

        let error = supervisor
            .shutdown()
            .expect_err("reaped MCP makes graceful stop fail");

        assert_eq!(error.service, "mcp");
        assert!(supervisor.events().iter().any(|event| matches!(
            event,
            SupervisorEvent::ShutdownTermRequested { service } if service == "backend"
        )));
        assert!(supervisor.running.is_none());
        assert!(supervisor.running_mcp.is_none());
    }

    #[test]
    fn contract_full_service_shutdown_stops_mcp_before_the_backend() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let mut supervisor = Supervisor::new(stub_table_with_mcp(), fast_options());
        supervisor.launch().expect("the supervised pair starts");

        supervisor.shutdown().expect("the supervised pair stops");

        let events = supervisor.events();
        let mcp_term = events.iter().position(|event| {
            matches!(event, SupervisorEvent::ShutdownTermRequested { service } if service == "mcp")
        });
        let backend_term = events.iter().position(|event| {
            matches!(
                event,
                SupervisorEvent::ShutdownTermRequested { service } if service == "backend"
            )
        });
        assert!(
            mcp_term.is_some() && mcp_term < backend_term,
            "MCP must be asked to stop before the backend it depends on"
        );
        assert!(
            supervisor.running.is_none() && supervisor.running_mcp.is_none(),
            "no owned handle may remain after a full-service shutdown"
        );

        let after_first = supervisor.events().len();
        supervisor
            .shutdown()
            .expect("a repeated full-service shutdown owns no handle");
        assert_eq!(
            supervisor.events().len(),
            after_first,
            "each handle is taken exactly once, so nothing is signalled twice"
        );
    }

    #[test]
    fn contract_degraded_mcp_shutdown_still_tears_down_the_backend() {
        let _guard = MCP_TEST_LOCK.lock().expect("MCP test lock");
        let occupied = TcpListener::bind("127.0.0.1:0").expect("reserve MCP port");
        let blocked_port = occupied.local_addr().expect("address").port();
        let mut options = fast_options();
        options.mcp_port_candidates = vec![blocked_port];
        options.mcp_required = false;
        let mut table = stub_table_with_mcp();
        table.backend.environment =
            vec![(OsString::from("MUXED_STUB_MODE"), OsString::from("ready"))];
        let mut supervisor = Supervisor::new(table, options);
        supervisor.launch().expect("the backend starts without MCP");
        assert_eq!(supervisor.mcp_port(), None, "MCP is degraded, not owned");

        supervisor
            .shutdown()
            .expect("degraded MCP must not weaken backend cleanup");

        let events = supervisor.events();
        assert!(
            events.iter().any(|event| matches!(
                event,
                SupervisorEvent::ShutdownTermRequested { service } if service == "backend"
            )),
            "the backend still receives its normal graceful teardown"
        );
        assert!(
            !events.iter().any(|event| matches!(
                event,
                SupervisorEvent::ShutdownTermRequested { service }
                    | SupervisorEvent::ShutdownKillRequested { service } if service == "mcp"
            )),
            "an unowned MCP service must never be signalled"
        );
        assert!(supervisor.running.is_none());
    }

    #[test]
    fn mcp_probe_rejects_responses_larger_than_sixty_four_kibibytes() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind streaming MCP peer");
        let port = listener.local_addr().expect("streaming MCP address").port();
        let server = thread::spawn(move || {
            let mut stream = listener.accept().expect("accept MCP probe").0;
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let oversized = vec![b'x'; MCP_RESPONSE_LIMIT_BYTES + 4096];
            let _ = stream.write_all(&oversized);
        });

        assert!(!mcp_initialize_succeeds(
            port,
            Instant::now() + Duration::from_secs(1)
        ));
        server.join().expect("streaming MCP peer exits");
    }

    #[test]
    fn mcp_probe_stops_streaming_at_the_absolute_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind slow MCP peer");
        let port = listener.local_addr().expect("slow MCP address").port();
        let server = thread::spawn(move || {
            let mut stream = listener.accept().expect("accept MCP probe").0;
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            while stream.write_all(b"x").is_ok() {
                thread::sleep(Duration::from_millis(2));
            }
        });
        let started = Instant::now();

        assert!(!mcp_initialize_succeeds(
            port,
            started + Duration::from_millis(40)
        ));
        assert!(started.elapsed() < Duration::from_millis(200));
        server.join().expect("slow MCP peer exits");
    }

    #[test]
    fn contract_bounds_and_redacts_captured_output() {
        let mut options = fast_options();
        options.log_limit_bytes = 120;
        let mut supervisor = Supervisor::new(stub_table("chatty", vec![]), options);
        let secret = supervisor.credential.clone();
        supervisor.launch().expect("starts");
        until(|| !supervisor.logs().is_empty());
        let logs = supervisor.logs().join("\n");
        assert!(logs.len() <= 120);
        assert!(logs.contains("[REDACTED]"));
        assert!(!logs.contains(&secret));
        supervisor.shutdown().expect("shutdown");
    }

    #[test]
    fn packaging_contract_persists_a_private_rotating_redacted_sidecar_log() {
        let data_directory = unique_temp_path("supervisor-sidecar-data");
        fs::create_dir_all(&data_directory).expect("create data directory");
        let log_path = data_directory.join("sidecar.log");
        let mut options = fast_options();
        options.sidecar_log_limit_bytes = 240;
        options.sidecar_log_generations = 3;
        options.restart_limit = 3;
        options.restart_backoff = vec![Duration::ZERO; 3];
        let mut supervisor = Supervisor::new(
            stub_table_at("chatty-then-crash-always", vec![], log_path.clone()),
            options,
        );
        let credential = supervisor.credential().to_owned();

        supervisor.launch().expect("first sidecar becomes ready");
        loop {
            if supervisor.poll().is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        until(|| {
            sidecar_log_paths(&log_path)
                .iter()
                .filter_map(|path| fs::read_to_string(path).ok())
                .any(|contents| contents.contains("[REDACTED]"))
        });
        supervisor.shutdown().expect("shutdown");

        assert_eq!(supervisor.log_path(), log_path.as_path());
        assert!(supervisor.log_path().is_absolute());
        assert!(log_path.is_file());
        let paths = sidecar_log_paths(&log_path);
        assert!(paths.len() <= 3);
        let total_bytes = paths
            .iter()
            .map(|path| fs::metadata(path).expect("log metadata").len())
            .sum::<u64>();
        assert!(total_bytes <= 240);
        let contents = paths
            .iter()
            .map(|path| fs::read_to_string(path).expect("read persisted log"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(contents.contains("[REDACTED]"));
        assert!(!contents.contains(&credential));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&log_path)
                .expect("sidecar log metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        fs::remove_dir_all(data_directory).expect("remove data directory");
    }

    #[test]
    fn external_desktop_records_share_sidecar_redaction_and_persistence() {
        let log_path = unique_temp_path("frontend-sidecar.log");
        let mut supervisor = Supervisor::new(
            stub_table_at("ready", vec![], log_path.clone()),
            fast_options(),
        );
        let credential = supervisor.credential().to_owned();

        supervisor.append_log_line(&format!(
            "[frontend][warn] request failed credential={credential}"
        ));

        let persisted = fs::read_to_string(&log_path).expect("read frontend record");
        assert!(persisted.contains("[frontend][warn] request failed"));
        assert!(persisted.contains("credential=[REDACTED]"));
        assert!(!persisted.contains(&credential));
        supervisor.shutdown().expect("stop unused supervisor");
        fs::remove_file(log_path).expect("remove frontend sidecar log");
    }

    #[test]
    fn stub_sidecar() {
        let Ok(mode) = env::var("MUXED_STUB_MODE") else {
            return;
        };
        let port = env::var("MUXED_BACKEND_PORT").expect("port passed by supervisor");
        let credential = env::var(CREDENTIAL_ENV).expect("credential passed by supervisor");
        if PYINSTALLER_PARENT_ENV
            .into_iter()
            .any(|name| env::var_os(name).is_some())
        {
            println!("{FAILURE_PREFIX}crash stale PyInstaller parent state was inherited");
            std::process::exit(39);
        }
        match mode.as_str() {
            "ready" => serve_health(&port),
            "ready-with-mcp" => {
                let mcp_url = env::var(MCP_URL_ENV).unwrap_or_default();
                if !mcp_url.starts_with("http://127.0.0.1:") || !mcp_url.ends_with("/mcp") {
                    println!("{FAILURE_PREFIX}crash MCP URL was not injected");
                } else {
                    println!("stub-mcp-url={mcp_url}");
                    serve_health(&port);
                }
            }
            "ready-reporting-mcp-absence" => {
                let unavailable = env::var(MCP_UNAVAILABLE_ENV).unwrap_or_default();
                let url = env::var(MCP_URL_ENV).unwrap_or_default();
                println!("stub-mcp-unavailable={unavailable}");
                println!("stub-mcp-url={url}");
                serve_health(&port);
            }
            "ready-with-mcp-then-crash-once" => {
                let mcp_url = env::var(MCP_URL_ENV).unwrap_or_default();
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                println!("credential={credential}");
                if !mcp_url.starts_with("http://127.0.0.1:") || !mcp_url.ends_with("/mcp") {
                    println!("{FAILURE_PREFIX}crash MCP URL was not injected");
                } else if !marker.exists() {
                    OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .open(marker)
                        .expect("mark crash");
                    let _listener = bind_ready(&port);
                    thread::sleep(Duration::from_millis(25));
                    std::process::exit(37);
                } else {
                    serve_health(&port);
                }
            }
            "mcp-ready" | "mcp-ready-then-crash-once" => {
                let mcp_port = env::var("MCP_PORT").expect("MCP port passed by supervisor");
                let listener =
                    TcpListener::bind(format!("127.0.0.1:{mcp_port}")).expect("bind MCP stub");
                for stream in listener.incoming() {
                    let mut stream = stream.expect("accept MCP probe");
                    let mut request = [0_u8; 2048];
                    let _ = stream.read(&mut request);
                    let body = "event: message\ndata: {\"result\":{\"serverInfo\":{\"name\":\"worktracker-agent\"}}}\n\n";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream
                        .write_all(response.as_bytes())
                        .expect("respond to MCP probe");
                    if mode == "mcp-ready-then-crash-once" {
                        let marker =
                            PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                        if OpenOptions::new()
                            .create_new(true)
                            .write(true)
                            .open(marker)
                            .is_ok()
                        {
                            thread::sleep(Duration::from_millis(25));
                            std::process::exit(38);
                        }
                    }
                }
            }
            "auth" => {
                println!("credential={credential}");
                let expected = env::var("MUXED_STUB_EXPECTED_CREDENTIAL").unwrap_or_default();
                if credential != expected {
                    println!("{FAILURE_PREFIX}authentication credential rejected");
                } else {
                    serve_health(&port);
                }
            }
            "migration" => println!("{FAILURE_PREFIX}migration database upgrade failed"),
            "ready-then-migration" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                if OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(marker)
                    .is_ok()
                {
                    let _listener = bind_ready(&port);
                    thread::sleep(Duration::from_millis(25));
                    std::process::exit(37);
                } else {
                    println!("{FAILURE_PREFIX}migration database could not be migrated");
                }
            }
            "no-ready" => thread::sleep(Duration::from_secs(2)),
            "ignore-term" => {
                #[cfg(unix)]
                unsafe {
                    libc::signal(libc::SIGTERM, libc::SIG_IGN);
                }
                serve_health(&port);
            }
            "ready-with-descendant" => {
                // A PyInstaller-shaped tree: a bootloader-style parent that
                // keeps serving, plus a worker that holds a loopback resource
                // and refuses to stop cooperatively.  One teardown therefore
                // has to end two processes by two different exit paths.
                if let Some(path) = env::var_os("MUXED_STUB_PARENT_PID_PATH") {
                    fs::write(path, std::process::id().to_string()).expect("record the parent pid");
                }
                #[cfg(unix)]
                if let Some(path) = env::var_os("MUXED_STUB_PARENT_EXIT_PATH") {
                    record_cooperative_exit_on_term(Path::new(&path));
                }
                Command::new(env::current_exe().expect("test executable"))
                    .args(["--exact", "supervisor::tests::stub_sidecar", "--nocapture"])
                    .env("MUXED_STUB_MODE", "descendant-ignore-term")
                    .spawn()
                    .expect("spawn stubborn descendant");
                serve_health(&port);
            }
            "ready-with-descendant-then-crash-once" => {
                // The same PyInstaller shape, except the bootloader-style
                // parent dies unexpectedly once its worker holds the loopback
                // resource: the direct child is gone while the owned group is
                // not empty.  Only the first instance does this, so the
                // replacement the supervisor starts is an ordinary sidecar.
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                if OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(marker)
                    .is_err()
                {
                    serve_health(&port);
                    return;
                }
                let descendant_port: u16 = env::var("MUXED_STUB_DESCENDANT_PORT")
                    .expect("descendant port")
                    .parse()
                    .expect("a numeric descendant port");
                Command::new(env::current_exe().expect("test executable"))
                    .args(["--exact", "supervisor::tests::stub_sidecar", "--nocapture"])
                    .env("MUXED_STUB_MODE", "descendant-ignore-term")
                    .spawn()
                    .expect("spawn stubborn descendant");
                let _listener = bind_ready(&port);
                // Exiting before the worker holds the port would leave nothing
                // for the supervisor to find surviving.
                while TcpStream::connect(("127.0.0.1", descendant_port)).is_err() {
                    thread::sleep(Duration::from_millis(10));
                }
                std::process::exit(37);
            }
            "exit-with-descendant" | "mcp-exit-with-descendant" => {
                // The same PyInstaller shape, failing this time during startup:
                // the bootloader-style parent hands off to a worker and then
                // exits without ever reporting readiness.  The worker records
                // the cooperative request it honours, so a test can tell an
                // ordered teardown of the partially started group from the
                // forced last resort every dropped handle already performs.
                let pid_path = env::var("MUXED_STUB_DESCENDANT_PID_PATH")
                    .expect("descendant pid path passed by the test");
                Command::new("/bin/sh")
                    .arg("-c")
                    .arg(format!(
                        "trap 'echo stopped-cooperatively > {pid_path}.stop; exit 0' TERM; \
                         echo $$ > {pid_path}; while :; do sleep 0.05; done"
                    ))
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("spawn the startup worker");
                // Exiting before the worker records itself would leave nothing
                // for the supervisor to find surviving.
                while recorded_pid_if_any(Path::new(&pid_path)).is_none() {
                    thread::sleep(Duration::from_millis(10));
                }
                std::process::exit(37);
            }
            "unrelated-sentinel" => {
                // Deliberately shaped like a target a process search would find:
                // the same executable as the sidecar, holding a loopback port.
                let sentinel_port = env::var("MUXED_STUB_DESCENDANT_PORT").expect("sentinel port");
                let _listener = TcpListener::bind(format!("127.0.0.1:{sentinel_port}"))
                    .expect("bind sentinel port");
                println!("stub-sentinel-listening");
                loop {
                    thread::sleep(Duration::from_millis(25));
                }
            }
            "descendant-ignore-term" => {
                #[cfg(unix)]
                unsafe {
                    libc::signal(libc::SIGTERM, libc::SIG_IGN);
                }
                let descendant_port =
                    env::var("MUXED_STUB_DESCENDANT_PORT").expect("descendant port");
                let _listener = TcpListener::bind(format!("127.0.0.1:{descendant_port}"))
                    .expect("bind descendant port");
                loop {
                    thread::sleep(Duration::from_millis(25));
                }
            }
            "chatty" => {
                for number in 0..50 {
                    println!("noisy-sidecar-line-{number:02}");
                }
                println!("credential={credential}");
                serve_health(&port);
            }
            "chatty-then-crash-always" => {
                for number in 0..50 {
                    println!("noisy-sidecar-line-{number:02}");
                }
                println!("credential={credential}");
                thread::spawn(|| {
                    thread::sleep(Duration::from_millis(100));
                    std::process::exit(37);
                });
                serve_health(&port);
            }
            "ready-then-crash-once" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                if !marker.exists() {
                    OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .open(marker)
                        .expect("mark crash");
                    let _listener = bind_ready(&port);
                    thread::sleep(Duration::from_millis(25));
                    std::process::exit(37);
                }
                serve_health(&port);
            }
            "ready-then-wedge-once" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                if OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(marker)
                    .is_ok()
                {
                    let listener = bind_ready(&port);
                    let _stream = listener.accept().expect("accept liveness probe").0;
                    loop {
                        thread::sleep(Duration::from_millis(25));
                    }
                }
                serve_health(&port);
            }
            "health-failures-reset" => {
                let listener = bind_ready(&port);
                let failures = [true, true, false, true, true, false];
                for (index, stream) in listener.incoming().enumerate() {
                    let mut stream = stream.expect("accept backend health probe");
                    let mut request = [0_u8; 2048];
                    let _ = stream.read(&mut request);
                    if !failures.get(index).copied().unwrap_or(false) {
                        respond_health(&mut stream);
                    }
                }
            }
            "health-slow" => {
                let listener = bind_ready(&port);
                for stream in listener.incoming() {
                    let mut stream = stream.expect("accept backend health probe");
                    let mut request = [0_u8; 2048];
                    let _ = stream.read(&mut request);
                    thread::sleep(Duration::from_millis(30));
                    respond_health(&mut stream);
                }
            }
            "health-probe-in-flight" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                let listener = bind_ready(&port);
                let mut stream = listener.accept().expect("accept backend health probe").0;
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request);
                fs::write(marker, b"in-flight").expect("mark probe in flight");
                loop {
                    thread::sleep(Duration::from_millis(25));
                }
            }
            "health-delayed-ready" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                let listener =
                    TcpListener::bind(format!("127.0.0.1:{port}")).expect("bind health stub");
                listener
                    .set_nonblocking(true)
                    .expect("make health stub nonblocking");
                let deadline = Instant::now() + Duration::from_millis(80);
                while Instant::now() < deadline {
                    match listener.accept() {
                        Ok(_) => fs::write(&marker, b"early probe").expect("mark early probe"),
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(error) => panic!("accept early health probe: {error}"),
                    }
                    thread::sleep(Duration::from_millis(2));
                }
                listener
                    .set_nonblocking(false)
                    .expect("make health stub blocking");
                println!("{READINESS_PREFIX}{port}");
                serve_health_listener(listener);
            }
            "ready-then-crash-always" => {
                thread::spawn(|| {
                    thread::sleep(Duration::from_millis(25));
                    std::process::exit(37);
                });
                serve_health(&port);
            }
            "ready-then-crash-until-marker" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                thread::spawn(move || loop {
                    if !marker.exists() {
                        thread::sleep(Duration::from_millis(25));
                        std::process::exit(37);
                    }
                    thread::sleep(Duration::from_millis(5));
                });
                serve_health(&port);
            }
            "ready-crash-reset-sequence" => {
                let marker = PathBuf::from(env::var_os("MUXED_STUB_MARKER").expect("marker"));
                let generation = fs::read_to_string(&marker)
                    .ok()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                fs::write(&marker, (generation + 1).to_string()).expect("advance generation");
                match generation {
                    0 => {
                        thread::spawn(|| {
                            thread::sleep(Duration::from_millis(25));
                            std::process::exit(37);
                        });
                    }
                    1 => {
                        thread::spawn(|| {
                            thread::sleep(Duration::from_millis(150));
                            std::process::exit(37);
                        });
                    }
                    _ => {}
                }
                serve_health(&port);
            }
            other => panic!("unknown stub mode {other}"),
        }
        loop {
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn bind_ready(port: &str) -> TcpListener {
        let listener =
            TcpListener::bind(format!("127.0.0.1:{port}")).expect("bind backend health stub");
        println!("{READINESS_PREFIX}{port}");
        listener
    }

    fn serve_health(port: &str) {
        let listener = bind_ready(port);
        serve_health_listener(listener);
    }

    fn serve_health_listener(listener: TcpListener) {
        for stream in listener.incoming() {
            let mut stream = stream.expect("accept backend health probe");
            let mut request = [0_u8; 2048];
            let count = stream.read(&mut request).expect("read health probe");
            if request[..count].starts_with(b"GET /api/healthz HTTP/1.1\r\n") {
                respond_health(&mut stream);
            }
        }
    }

    fn respond_health(stream: &mut TcpStream) {
        let body = r#"{"ok": true}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("respond to health probe");
    }

    fn unique_temp_path(prefix: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn sidecar_log_paths(log_path: &Path) -> Vec<PathBuf> {
        let mut paths = vec![log_path.to_path_buf()];
        paths.extend((1..3).map(|generation| {
            log_path.with_file_name(format!(
                "{}.{generation}",
                log_path
                    .file_name()
                    .expect("sidecar log file name")
                    .to_string_lossy()
            ))
        }));
        paths.into_iter().filter(|path| path.is_file()).collect()
    }

    #[test]
    fn known_failure_classes_keep_their_kind() {
        for (class, expected) in [
            ("migration", FailureKind::Migration),
            ("authentication", FailureKind::Authentication),
            ("bind", FailureKind::Bind),
            ("crash", FailureKind::Crash),
        ] {
            let line = format!("{FAILURE_PREFIX}{class} something went wrong");
            assert_eq!(
                parse_control_line(&line, 1234),
                ControlLine::Failure(expected, "something went wrong".to_owned()),
            );
        }
    }

    #[test]
    fn an_unknown_failure_class_is_reported_not_dropped() {
        // Dropping it to `Other` turned an announced, deterministic failure
        // into a readiness timeout the supervisor retried until the restart
        // budget was gone. The raw class stays in the message so the give-up
        // screen still names the cause.
        let line = format!("{FAILURE_PREFIX}newclass something went wrong");

        assert_eq!(
            parse_control_line(&line, 1234),
            ControlLine::Failure(
                FailureKind::Crash,
                "newclass: something went wrong".to_owned(),
            ),
        );
    }

    #[test]
    fn a_line_without_the_failure_prefix_is_still_other() {
        assert_eq!(
            parse_control_line("some ordinary log line", 1234),
            ControlLine::Other,
        );
    }

    fn restarting_attempts(supervisor: &Supervisor) -> Vec<usize> {
        supervisor
            .events()
            .into_iter()
            .filter_map(|event| match event {
                SupervisorEvent::Restarting { service, attempt } if service == "backend" => {
                    Some(attempt)
                }
                _ => None,
            })
            .collect()
    }
}
