use serde::Serialize;
use std::env::{self, VarError};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

use ownership::{
    established_data_directory, DataDirectoryAccess, DataDirectoryGuard, DevelopmentMode,
    DEVELOPMENT_BACKEND_PORT,
};
use supervisor::{CommandTable, Supervisor, SupervisorError, SupervisorEvent, SupervisorOptions};

pub mod discovery;
pub mod native_terminal;
pub mod ownership;
mod release_manifest;
pub mod supervisor;
pub mod tmux_viewer;
pub mod viewer_commands;

const MAIN_WINDOW_LABEL: &str = "main";
const SMOKE_EXIT_AFTER_STARTUP: &str = "MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP";
const SMOKE_SIDECAR_BINARY: &str = "MUXED_DESKTOP_SMOKE_SIDECAR_BINARY";
const PACKAGED_HOOK_RUNNER_ENV: &str = "MUXED_PACKAGED_HOOK_RUNNER";
const HOOK_RUNNER_BINARY: &str = "ticketry-hook";
const DEVELOPMENT_BACKEND_PORT_ENV: &str = "MUXED_DESKTOP_BACKEND_PORT";
const HEALTH_EVENT: &str = "desktop-service-health";
const DEVELOPMENT_WEBVIEW_ORIGIN: &str = "http://127.0.0.1:5174";
const PACKAGED_WEBVIEW_ORIGIN: &str = "http://tauri.localhost";

/// Kept in Tauri managed state for the entire lifetime of any backend that
/// the desktop may start.  `None` is the deliberate `pnpm dev` connect mode.
struct DesktopDataDirectoryOwnership {
    data_directory: PathBuf,
    guard: Mutex<Option<DataDirectoryGuard>>,
}

fn acquire_data_directory_ownership() -> Result<DesktopDataDirectoryOwnership, String> {
    let mode = DevelopmentMode::from_environment().map_err(|error| error.to_string())?;
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let development_backend_port = if cfg!(debug_assertions) {
        optional_port(DEVELOPMENT_BACKEND_PORT_ENV)?.unwrap_or(DEVELOPMENT_BACKEND_PORT)
    } else {
        DEVELOPMENT_BACKEND_PORT
    };
    let guard = match DataDirectoryGuard::acquire(&data_directory, mode, development_backend_port)
        .map_err(|error| {
        format!(
            "could not own selected data directory {}: {error}",
            data_directory.display()
        )
    })? {
        DataDirectoryAccess::Owned(guard) => Some(guard),
        DataDirectoryAccess::DevelopmentStack => None,
    };
    Ok(DesktopDataDirectoryOwnership {
        data_directory,
        guard: Mutex::new(guard),
    })
}

fn release_data_directory_ownership(application: &tauri::AppHandle) {
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let guard = ownership
        .guard
        .lock()
        .expect("data-directory lock poisoned")
        .take();
    if let Some(guard) = guard {
        if let Err(error) = guard.release() {
            eprintln!(
                "Ticketry could not release data-directory ownership for {}: {error}",
                ownership.data_directory.display()
            );
        }
    }
}

fn shutdown_packaged_backend(application: &tauri::AppHandle) {
    let state = application.state::<DesktopServiceState>();
    state.stopping.store(true, Ordering::Release);
    let supervisor = state
        .supervisor
        .lock()
        .expect("supervisor lock poisoned")
        .take();
    if let Some(mut supervisor) = supervisor {
        if let Err(error) = supervisor.shutdown() {
            eprintln!("Ticketry could not stop its backend sidecar: {error}");
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopLifecycleEvent {
    StartupReady,
    FatalInitialization,
    MainWindowCloseRequested,
    ApplicationShutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopLifecycleAction {
    Continue,
    Exit(i32),
    Finished,
}

fn lifecycle_action(event: DesktopLifecycleEvent) -> DesktopLifecycleAction {
    match event {
        DesktopLifecycleEvent::StartupReady => DesktopLifecycleAction::Continue,
        DesktopLifecycleEvent::FatalInitialization => DesktopLifecycleAction::Exit(1),
        DesktopLifecycleEvent::MainWindowCloseRequested => DesktopLifecycleAction::Exit(0),
        DesktopLifecycleEvent::ApplicationShutdown => DesktopLifecycleAction::Finished,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // `degraded` is reserved for lazy MCP capability failures.
enum ServiceHealthState {
    Starting,
    Migrating,
    Ready,
    Recovering,
    Degraded,
    Failed,
}

/// Stable desktop-facing state. Process names and exits stay inside the
/// supervisor; Studio only receives this small, actionable contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceHealth {
    state: ServiceHealthState,
    service: Option<String>,
    message: Option<String>,
    log_pointer: Option<String>,
}

impl ServiceHealth {
    fn starting() -> Self {
        Self {
            state: ServiceHealthState::Starting,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    fn migrating() -> Self {
        Self {
            state: ServiceHealthState::Migrating,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    fn ready() -> Self {
        Self {
            state: ServiceHealthState::Ready,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    fn recovering() -> Self {
        Self {
            state: ServiceHealthState::Recovering,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    fn failed(error: &SupervisorError, log_path: &Path) -> Self {
        let message = match error.kind {
            supervisor::FailureKind::Migration => {
                "The state database could not be migrated.".to_owned()
            }
            _ => error.message.clone(),
        };
        Self {
            state: ServiceHealthState::Failed,
            service: Some(error.service.clone()),
            message: Some(message),
            log_pointer: Some(log_path.display().to_string()),
        }
    }
}

const WORKTRACKER_MCP_REQUIRED: bool = true;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEndpoints {
    work_tracker_api: String,
    agent_api: String,
    status_api: String,
    status_web_socket: String,
    terminal_web_socket: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeValues {
    work_tracker_api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStartupConfiguration {
    endpoints: RuntimeEndpoints,
    values: RuntimeValues,
    service_health: ServiceHealth,
}

struct DesktopServiceState {
    supervisor: Mutex<Option<Supervisor>>,
    configuration: Mutex<Option<RuntimeStartupConfiguration>>,
    health: Mutex<ServiceHealth>,
    stopping: AtomicBool,
}

impl DesktopServiceState {
    fn new() -> Self {
        Self {
            supervisor: Mutex::new(None),
            configuration: Mutex::new(None),
            health: Mutex::new(ServiceHealth::starting()),
            stopping: AtomicBool::new(false),
        }
    }

    fn record_health(&self, health: ServiceHealth) {
        *self.health.lock().expect("service health lock poisoned") = health;
    }

    fn publish(&self, application: &tauri::AppHandle, health: ServiceHealth) {
        self.record_health(health.clone());
        let _ = application.emit(HEALTH_EVENT, health);
    }

    fn configuration(&self) -> Result<RuntimeStartupConfiguration, String> {
        let mut configuration = self
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned")
            .clone()
            .ok_or_else(|| {
                "Desktop backend is still starting; wait for its service-health event".to_owned()
            })?;
        configuration.service_health = self
            .health
            .lock()
            .expect("service health lock poisoned")
            .clone();
        Ok(configuration)
    }
}

fn endpoint(name: &str, default: &str) -> Result<String, String> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() && value == value.trim() => Ok(value),
        Ok(_) => Err(format!(
      "Desktop initialization failed: {name} must not be empty or contain surrounding whitespace"
    )),
        Err(VarError::NotPresent) => Ok(default.to_owned()),
        Err(error) => Err(format!(
            "Desktop initialization failed: could not read {name}: {error}"
        )),
    }
}

fn optional_value(name: &str) -> Result<String, String> {
    match env::var(name) {
        Ok(value) => Ok(value),
        Err(VarError::NotPresent) => Ok(String::new()),
        Err(error) => Err(format!(
            "Desktop initialization failed: could not read {name}: {error}"
        )),
    }
}

fn default_runtime_endpoints() -> RuntimeEndpoints {
    // This is deliberately development-only. Packaged endpoints come from the
    // ready supervisor and must never fall back to a fixed backend port.
    let port = "5174";
    let http_origin = format!("http://127.0.0.1:{port}");
    let web_socket_origin = format!("ws://127.0.0.1:{port}");

    RuntimeEndpoints {
        work_tracker_api: format!("{http_origin}/api/work-tracker"),
        agent_api: format!("{http_origin}/api"),
        status_api: format!("{http_origin}/api"),
        status_web_socket: format!("{web_socket_origin}/ws/status"),
        terminal_web_socket: format!("{web_socket_origin}/ws/terminal"),
    }
}

fn development_runtime_configuration() -> Result<RuntimeStartupConfiguration, String> {
    let defaults = default_runtime_endpoints();

    Ok(RuntimeStartupConfiguration {
        endpoints: RuntimeEndpoints {
            work_tracker_api: endpoint(
                "MUXED_DESKTOP_WORKTRACKER_API",
                &defaults.work_tracker_api,
            )?,
            agent_api: endpoint("MUXED_DESKTOP_AGENT_API", &defaults.agent_api)?,
            status_api: endpoint("MUXED_DESKTOP_STATUS_API", &defaults.status_api)?,
            status_web_socket: endpoint(
                "MUXED_DESKTOP_STATUS_WEBSOCKET",
                &defaults.status_web_socket,
            )?,
            terminal_web_socket: endpoint(
                "MUXED_DESKTOP_TERMINAL_WEBSOCKET",
                &defaults.terminal_web_socket,
            )?,
        },
        values: RuntimeValues {
            work_tracker_api_key: optional_value("MUXED_DESKTOP_WORKTRACKER_API_KEY")?,
        },
        service_health: ServiceHealth::ready(),
    })
}

fn sidecar_runtime_configuration(port: u16, credential: &str) -> RuntimeStartupConfiguration {
    let http_origin = format!("http://127.0.0.1:{port}");
    let web_socket_origin = format!("ws://127.0.0.1:{port}");
    RuntimeStartupConfiguration {
        endpoints: RuntimeEndpoints {
            work_tracker_api: format!("{http_origin}/api/work-tracker"),
            agent_api: format!("{http_origin}/api"),
            status_api: format!("{http_origin}/api"),
            status_web_socket: format!("{web_socket_origin}/ws/status"),
            terminal_web_socket: format!("{web_socket_origin}/ws/terminal"),
        },
        values: RuntimeValues {
            work_tracker_api_key: credential.to_owned(),
        },
        service_health: ServiceHealth::ready(),
    }
}

fn packaged_resource_binary(
    application: &tauri::App,
    binary: &str,
    missing_message: &str,
) -> Result<PathBuf, String> {
    let resource_dir = application
        .path()
        .resource_dir()
        .map_err(|error| format!("could not locate packaged runtime resources: {error}"))?;
    // Tauri strips the source sidecar's target-triple suffix when it copies the
    // executable into app resources.
    [
        resource_dir.join(binary),
        resource_dir.join("binaries").join(binary),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| missing_message.to_owned())
}

fn sidecar_binary(application: &tauri::App) -> Result<PathBuf, String> {
    if env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1") {
        return env::var_os(SMOKE_SIDECAR_BINARY)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| format!("{SMOKE_SIDECAR_BINARY} must name the absolute built sidecar"));
    }

    let binary = release_manifest::packaged_sidecar_name()?;
    packaged_resource_binary(
        application,
        &binary,
        "packaged backend sidecar is missing from application resources",
    )
}

fn hook_runner_binary(application: &tauri::App) -> Result<PathBuf, String> {
    let binary = format!("{HOOK_RUNNER_BINARY}{}", env::consts::EXE_SUFFIX);
    packaged_resource_binary(
        application,
        &binary,
        "packaged hook runner is missing from application resources",
    )
}

fn desktop_webview_origin() -> Result<String, String> {
    if cfg!(debug_assertions) {
        endpoint("MUXED_DESKTOP_ORIGIN", DEVELOPMENT_WEBVIEW_ORIGIN)
    } else {
        Ok(PACKAGED_WEBVIEW_ORIGIN.to_owned())
    }
}

fn development_supervisor_options() -> Result<SupervisorOptions, String> {
    let mut options = SupervisorOptions::default();
    if cfg!(debug_assertions) {
        match (
            optional_port(DEVELOPMENT_BACKEND_PORT_ENV)?,
            optional_port("MUXED_DESKTOP_MCP_PORT")?,
        ) {
            (Some(backend), Some(mcp)) => {
                options.port_candidates = vec![backend];
                options.mcp_port_candidates = vec![mcp];
            }
            (None, None) => {}
            _ => {
                return Err(
                    "MUXED_DESKTOP_BACKEND_PORT and MUXED_DESKTOP_MCP_PORT must be set together"
                        .to_owned(),
                )
            }
        }
    }
    Ok(options)
}

fn optional_port(name: &str) -> Result<Option<u16>, String> {
    let Some(value) = env::var_os(name) else {
        return Ok(None);
    };
    let value = value
        .into_string()
        .map_err(|_| format!("{name} must contain valid UTF-8"))?;
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .map(Some)
        .ok_or_else(|| format!("{name} must be a valid TCP port (1-65535)"))
}

fn launch_packaged_backend(application: &tauri::App) -> Result<(), String> {
    let state = application.state::<DesktopServiceState>();
    state.publish(application.handle(), ServiceHealth::starting());
    state.publish(application.handle(), ServiceHealth::migrating());

    let binary = sidecar_binary(application)?;
    let hook_runner = hook_runner_binary(application)?;
    let data_dir = established_data_directory().map_err(|error| error.to_string())?;
    let origin = desktop_webview_origin()?;
    let commands = if WORKTRACKER_MCP_REQUIRED {
        CommandTable::packaged_services(binary, data_dir, &origin)
    } else {
        CommandTable::packaged_backend(binary, data_dir, &origin)
    }
    .map_err(|error| error.to_string())?
    .with_environment({
        let mut environment = discovery::resolved_tool_environment()?;
        environment.push((
            PACKAGED_HOOK_RUNNER_ENV.to_owned(),
            hook_runner.to_string_lossy().into_owned(),
        ));
        environment
    });
    let mut supervisor = Supervisor::try_new(commands, development_supervisor_options()?)
        .map_err(|error| error.to_string())?;
    if let Err(error) = supervisor.launch() {
        let log_path = supervisor.log_path();
        state.publish(
            application.handle(),
            ServiceHealth::failed(&error, log_path),
        );
        return Err(format!(
            "desktop {} failed to start: {}; logs: {}",
            error.service,
            error.message,
            log_path.display()
        ));
    }
    let port = supervisor
        .port()
        .expect("ready supervisor retains its assigned port");
    if env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1") {
        if let Err(message) = verify_packaged_backend(port, supervisor.credential(), &origin) {
            let error = SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Authentication,
                message,
            };
            state.publish(
                application.handle(),
                ServiceHealth::failed(&error, supervisor.log_path()),
            );
            let _ = supervisor.shutdown();
            return Err("desktop backend smoke authentication check failed".to_owned());
        }
    }
    let configuration = sidecar_runtime_configuration(port, supervisor.credential());
    *state
        .configuration
        .lock()
        .expect("runtime configuration lock poisoned") = Some(configuration);
    *state.supervisor.lock().expect("supervisor lock poisoned") = Some(supervisor);
    state.publish(application.handle(), ServiceHealth::ready());
    Ok(())
}

fn verify_packaged_backend(port: u16, credential: &str, origin: &str) -> Result<(), String> {
    let valid = sidecar_http_status(port, credential, origin)?;
    if valid != 200 {
        return Err(format!("authenticated request returned HTTP {valid}"));
    }
    let rejected = sidecar_http_status(port, "wrong-credential", "http://tauri.localhost")?;
    if rejected != 401 {
        return Err(format!(
            "invalid credential returned HTTP {rejected}, expected 401"
        ));
    }
    let origin_rejected = sidecar_http_status(port, credential, "http://untrusted.invalid")?;
    if origin_rejected != 403 {
        return Err(format!(
            "untrusted origin returned HTTP {origin_rejected}, expected 403"
        ));
    }
    Ok(())
}

fn sidecar_http_status(port: u16, credential: &str, origin: &str) -> Result<u16, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|error| format!("could not connect to ready backend: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(
            format!(
                "GET /api/work-tracker/projects HTTP/1.1\r\nHost: 127.0.0.1\r\nx-api-key: {credential}\r\nOrigin: {origin}\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .map_err(|error| format!("could not make authenticated request: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("could not read backend response: {error}"))?;
    response
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "backend returned no HTTP status".to_owned())?
        .parse::<u16>()
        .map_err(|error| format!("backend returned an invalid HTTP status: {error}"))
}

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

fn start_supervisor_monitor(application: tauri::AppHandle) {
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
            let pair_is_ready = supervisor.port().is_some()
                && (!WORKTRACKER_MCP_REQUIRED || supervisor.mcp_port().is_some());
            let health_updates = recovery_health_updates(new_events, pair_is_ready);
            observed_events = events.len();

            for event in new_events {
                if let SupervisorEvent::SidecarLogUnavailable { message } = event {
                    eprintln!("Ticketry sidecar log unavailable: {message}");
                }
            }
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
            }
        }
    });
}

fn absolute_folder_path(selection: Option<FilePath>) -> Result<Option<String>, String> {
    selection
        .map(|selected| {
            let path = selected.into_path().map_err(|error| {
                format!("native folder picker returned an invalid path: {error}")
            })?;
            if !path.is_absolute() {
                return Err("native folder picker returned a non-absolute path".to_owned());
            }
            path.into_os_string()
                .into_string()
                .map_err(|_| "native folder picker returned a non-Unicode path".to_owned())
        })
        .transpose()
}

#[tauri::command]
fn desktop_runtime_configuration(
    state: tauri::State<'_, DesktopServiceState>,
) -> Result<RuntimeStartupConfiguration, String> {
    state.configuration()
}

/// Rearm and relaunch the fixed supervised pair. The webview supplies no
/// program, path, argument, port, or environment value.
#[tauri::command]
fn desktop_retry_services(
    application: tauri::AppHandle,
    state: tauri::State<'_, DesktopServiceState>,
) -> Result<(), String> {
    let fallback_log_path = supervisor::sidecar_log_path(
        established_data_directory().map_err(|error| error.to_string())?,
    );
    let mut supervisor_guard = state.supervisor.lock().expect("supervisor lock poisoned");
    // Keep the complete retry health sequence under the same lock used by
    // the monitor so no stale poll result can be published after it.
    state.publish(&application, ServiceHealth::recovering());
    let (result, log_path) = match supervisor_guard.as_mut() {
        Some(supervisor) => (supervisor.retry(), supervisor.log_path().to_path_buf()),
        None => (
            Err(SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Crash,
                message: "desktop service supervision is unavailable".to_owned(),
            }),
            fallback_log_path,
        ),
    };
    match result {
        Ok(()) => {
            state.publish(&application, ServiceHealth::ready());
            Ok(())
        }
        Err(error) => {
            state.publish(&application, ServiceHealth::failed(&error, &log_path));
            Err(format!(
                "desktop {} retry failed: {}; logs: {}",
                error.service,
                error.message,
                log_path.display()
            ))
        }
    }
}

/// Open one directory-only native chooser parented to the local main window.
/// The webview receives only the selected absolute path or cancellation.
#[tauri::command]
async fn desktop_pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("native folder picker is restricted to the main window".to_owned());
    }
    absolute_folder_path(
        window
            .dialog()
            .file()
            .set_parent(&window)
            .blocking_pick_folder(),
    )
}

/// Read-only, zero-argument preflight.  The webview can request the fixed
/// report but cannot name a program, path, argument, or environment value.
#[tauri::command]
fn desktop_preflight_report() -> discovery::PreflightReport {
    discovery::preflight_report()
}

/// Approve one explicit path only for a named supported tool. Rust validates
/// it before writing, and the command deliberately accepts no argv or shell.
#[tauri::command]
fn desktop_approve_executable_path(
    tool: discovery::SupportedTool,
    path: String,
) -> Result<discovery::ToolDiagnostic, String> {
    discovery::approve_executable_path(tool, PathBuf::from(path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ownership = match acquire_data_directory_ownership() {
        Ok(ownership) => ownership,
        Err(error) => {
            eprintln!("Ticketry could not acquire data-directory ownership: {error}");
            std::process::exit(1);
        }
    };
    let application = match tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ownership)
        .manage(DesktopServiceState::new())
        .manage(viewer_commands::ViewerCommandState::new())
        .manage(native_terminal::NativeTerminalState::new())
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_configuration,
            desktop_retry_services,
            desktop_pick_folder,
            desktop_preflight_report,
            desktop_approve_executable_path,
            viewer_commands::viewer_attach,
            viewer_commands::viewer_input,
            viewer_commands::viewer_resize,
            viewer_commands::viewer_scroll,
            viewer_commands::viewer_detach,
            viewer_commands::viewer_status,
            native_terminal::native_terminal_available,
            native_terminal::native_terminal_attach,
            native_terminal::native_terminal_set_frame,
            native_terminal::native_terminal_focus,
            native_terminal::native_terminal_detach
        ])
        .setup(|application| {
            let owns_data_directory = application
                .state::<DesktopDataDirectoryOwnership>()
                .guard
                .lock()
                .expect("data-directory lock poisoned")
                .is_some();
            let state = application.state::<DesktopServiceState>();
            if owns_data_directory {
                launch_packaged_backend(application)?;
                start_supervisor_monitor(application.handle().clone());
            } else {
                let configuration = development_runtime_configuration()?;
                *state
                    .configuration
                    .lock()
                    .expect("runtime configuration lock poisoned") = Some(configuration);
                state.publish(application.handle(), ServiceHealth::ready());
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() == MAIN_WINDOW_LABEL
                && payload.event() == tauri::webview::PageLoadEvent::Finished
                && env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
            {
                webview.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
    {
        Ok(application) => application,
        Err(error) => {
            eprintln!("Ticketry failed to initialize: {error}");
            if let DesktopLifecycleAction::Exit(code) =
                lifecycle_action(DesktopLifecycleEvent::FatalInitialization)
            {
                std::process::exit(code);
            }
            unreachable!("fatal initialization must exit")
        }
    };

    application.run(|application, event| {
        let lifecycle_event = match &event {
            tauri::RunEvent::Ready => Some(DesktopLifecycleEvent::StartupReady),
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == MAIN_WINDOW_LABEL => {
                api.prevent_close();
                Some(DesktopLifecycleEvent::MainWindowCloseRequested)
            }
            tauri::RunEvent::Exit => {
                // Detach transient PTY viewers before stopping desktop
                // services. This intentionally does not signal or kill tmux,
                // whose sessions remain the durable owner of agent runs.
                application
                    .state::<viewer_commands::ViewerCommandState>()
                    .detach_all();
                application
                    .state::<native_terminal::NativeTerminalState>()
                    .detach_all();
                shutdown_packaged_backend(application);
                release_data_directory_ownership(application);
                Some(DesktopLifecycleEvent::ApplicationShutdown)
            }
            _ => None,
        };

        match lifecycle_event.map(lifecycle_action) {
            Some(DesktopLifecycleAction::Exit(code)) => application.exit(code),
            Some(DesktopLifecycleAction::Continue | DesktopLifecycleAction::Finished) | None => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIGURED_PORT_OWNERSHIP_CHILD: &str = "MUXED_CONFIGURED_PORT_OWNERSHIP_CHILD";

    #[test]
    fn runtime_configuration_uses_live_health_after_failed_publication() {
        let state = DesktopServiceState::new();
        let stored_configuration = sidecar_runtime_configuration(43_219, "per-launch-credential");
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(stored_configuration);
        let failed = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Crash,
                message: "restart allowance exhausted".to_owned(),
            },
            Path::new("/tmp/muxed-sidecar.log"),
        );
        state.record_health(failed.clone());

        let configuration = state.configuration().expect("runtime configuration");

        assert_eq!(configuration.service_health, failed);
    }

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

    #[test]
    fn failed_health_points_to_the_real_sidecar_log_without_expanding_its_shape() {
        let log_path = env::temp_dir().join("muxed-sidecar.log");
        let error = SupervisorError {
            service: "backend".to_owned(),
            kind: supervisor::FailureKind::Crash,
            message: "restart allowance exhausted".to_owned(),
        };

        let health = ServiceHealth::failed(&error, &log_path);
        let value = serde_json::to_value(&health).expect("serialize service health");

        assert_eq!(
            health.log_pointer.as_deref(),
            log_path.to_str(),
            "the give-up pointer is the real filesystem path"
        );
        assert!(log_path.is_absolute());
        assert_eq!(
            value
                .as_object()
                .expect("service health object")
                .keys()
                .collect::<Vec<_>>(),
            vec!["logPointer", "message", "service", "state"]
        );
        assert!(value.get("port").is_none());
        assert!(value.get("exitCode").is_none());
        assert!(value.get("processName").is_none());
    }

    #[test]
    fn migration_failure_health_names_the_database_without_changing_its_shape() {
        let log_path = env::temp_dir().join("muxed-sidecar.log");
        let health = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Migration,
                message: "internal migration detail".to_owned(),
            },
            &log_path,
        );

        assert_eq!(health.state, ServiceHealthState::Failed);
        assert_eq!(health.service.as_deref(), Some("backend"));
        assert_eq!(
            health.message.as_deref(),
            Some("The state database could not be migrated.")
        );
        assert_eq!(health.log_pointer.as_deref(), log_path.to_str());
    }

    #[test]
    fn configured_backend_port_keeps_an_unrelated_default_listener_out_of_ownership() {
        if env::var_os(CONFIGURED_PORT_OWNERSHIP_CHILD).is_some() {
            let ownership = acquire_data_directory_ownership()
                .expect("the configured backend port must drive ownership detection");
            if let Some(guard) = ownership
                .guard
                .into_inner()
                .expect("data-directory lock poisoned")
            {
                guard.release().expect("release configured-port owner");
            }
            return;
        }

        let default_responder = match std::net::TcpListener::bind((
            "127.0.0.1",
            DEVELOPMENT_BACKEND_PORT,
        )) {
            Ok(listener) => Some(std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept ownership health probe");
                let mut request = [0_u8; 256];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{\"ok\": true}",
                );
            })),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => None,
            Err(error) => panic!("occupy the default development port: {error}"),
        };
        let selected_listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .expect("reserve a selected development port");
        let selected_port = selected_listener
            .local_addr()
            .expect("read selected development port")
            .port();
        assert_ne!(selected_port, DEVELOPMENT_BACKEND_PORT);
        drop(selected_listener);

        let data_directory = env::temp_dir().join(format!(
            "muxed-configured-port-ownership-{}",
            std::process::id()
        ));
        let status = std::process::Command::new(env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "tests::configured_backend_port_keeps_an_unrelated_default_listener_out_of_ownership",
                "--nocapture",
            ])
            .env(CONFIGURED_PORT_OWNERSHIP_CHILD, "1")
            .env("MUXED_DATA_DIR", &data_directory)
            .env(DEVELOPMENT_BACKEND_PORT_ENV, selected_port.to_string())
            .status()
            .expect("start configured-port ownership child");

        if let Some(responder) = default_responder {
            let _ = std::net::TcpStream::connect(("127.0.0.1", DEVELOPMENT_BACKEND_PORT));
            responder.join().expect("join ownership health responder");
        }
        let _ = std::fs::remove_dir_all(data_directory);
        assert!(status.success());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_defaults_use_the_vite_proxy() {
        let endpoints = default_runtime_endpoints();

        assert_eq!(
            endpoints.work_tracker_api,
            "http://127.0.0.1:5174/api/work-tracker"
        );
        assert_eq!(endpoints.agent_api, "http://127.0.0.1:5174/api");
        assert_eq!(endpoints.status_api, "http://127.0.0.1:5174/api");
        assert_eq!(endpoints.status_web_socket, "ws://127.0.0.1:5174/ws/status");
        assert_eq!(
            endpoints.terminal_web_socket,
            "ws://127.0.0.1:5174/ws/terminal"
        );
    }

    #[test]
    fn sidecar_configuration_uses_the_assigned_port_and_credential() {
        let configuration = sidecar_runtime_configuration(43_219, "per-launch-credential");

        assert_eq!(
            configuration.endpoints.work_tracker_api,
            "http://127.0.0.1:43219/api/work-tracker"
        );
        assert_eq!(
            configuration.endpoints.status_web_socket,
            "ws://127.0.0.1:43219/ws/status"
        );
        assert_eq!(
            configuration.values.work_tracker_api_key,
            "per-launch-credential"
        );
        assert_eq!(
            configuration.service_health.state,
            ServiceHealthState::Ready
        );
    }

    #[test]
    fn explicit_environment_value_overrides_the_default() {
        let expected = env::var("PATH").expect("PATH must exist during tests");

        assert_eq!(endpoint("PATH", "fallback"), Ok(expected));
    }

    #[test]
    fn lifecycle_outcomes_cover_startup_failure_close_and_shutdown() {
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::StartupReady),
            DesktopLifecycleAction::Continue
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::FatalInitialization),
            DesktopLifecycleAction::Exit(1)
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::MainWindowCloseRequested),
            DesktopLifecycleAction::Exit(0)
        );
        assert_eq!(
            lifecycle_action(DesktopLifecycleEvent::ApplicationShutdown),
            DesktopLifecycleAction::Finished
        );
    }

    #[test]
    fn native_folder_result_maps_cancellation_and_one_absolute_path() {
        assert_eq!(absolute_folder_path(None), Ok(None));
        assert_eq!(
            absolute_folder_path(Some(tauri_plugin_dialog::FilePath::from(PathBuf::from(
                "/repos/picked"
            )))),
            Ok(Some("/repos/picked".to_owned()))
        );
    }

    #[test]
    fn native_folder_result_rejects_a_non_absolute_path() {
        assert_eq!(
            absolute_folder_path(Some(tauri_plugin_dialog::FilePath::from(PathBuf::from(
                "repos/picked"
            )))),
            Err("native folder picker returned a non-absolute path".to_owned())
        );
    }
}
