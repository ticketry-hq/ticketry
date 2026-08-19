//! Every desktop capability the webview may invoke. Each command names its
//! own authority: the main window only, no caller-supplied program, path,
//! port, or environment value.

use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

use crate::desktop::folder_selection::absolute_folder_path;
use crate::desktop::frontend_log::frontend_log_line;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;
use crate::desktop::mcp_runtime::ensure_in_process_mcp;
use crate::desktop::runtime_configuration::{
    sidecar_runtime_configuration, RuntimeStartupConfiguration,
};
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::service_state::DesktopServiceState;
use crate::ownership::established_data_directory;
use crate::supervisor::{self, SupervisorError};
use crate::{discovery, work_management};

#[tauri::command]
pub(crate) fn desktop_runtime_configuration(
    state: tauri::State<'_, DesktopServiceState>,
) -> Result<RuntimeStartupConfiguration, String> {
    state.configuration()
}

#[tauri::command]
pub(crate) async fn desktop_launch_default_coding_agent(
    window: tauri::WebviewWindow,
    issue_id: String,
    services: tauri::State<'_, DesktopServiceState>,
    launch: tauri::State<'_, DesktopLaunchRuntime>,
) -> Result<serde_json::Value, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("agent launch is restricted to the local main window".to_owned());
    }
    let configuration = services.configuration()?;
    // Reuse the pool and profile store composition already opened. A pool per
    // click would re-run the launch-policy DDL and take an exclusive write
    // lock on a `state.db` several writers are already sharing.
    work_management::launch_policy::submit_interactive(
        launch.commands()?,
        launch.profiles()?,
        &configuration.endpoints.agent_api,
        &configuration.values.work_tracker_api_key,
        issue_id,
    )
    .await
}

/// Development-only bridge from the local main webview to the fixed
/// supervisor-owned log. The webview cannot select a path or bypass the
/// supervisor's redaction and rotation policy.
#[tauri::command]
pub(crate) fn desktop_append_frontend_log(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DesktopServiceState>,
    level: String,
    message: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("frontend log persistence is available only in development".to_owned());
    }
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("frontend logs are restricted to the local main window".to_owned());
    }
    let line = frontend_log_line(&level, &message)?;
    let supervisor = state.supervisor.lock().expect("supervisor lock poisoned");
    let supervisor = supervisor
        .as_ref()
        .ok_or_else(|| "desktop service supervision is unavailable".to_owned())?;
    supervisor.append_log_line(&line);
    Ok(())
}

/// Rearm and relaunch the fixed supervised pair. The webview supplies no
/// program, path, argument, port, or environment value.
#[tauri::command]
pub(crate) fn desktop_retry_services(
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
        Some(supervisor) => {
            let observed_events = supervisor.events().len();
            let mut result = supervisor.retry();
            let events = supervisor.events();
            let new_events = events.get(observed_events..).unwrap_or(&[]);
            if result.is_ok() {
                state.retain_supervisor_notices(new_events);
                let port = supervisor
                    .port()
                    .expect("successful retry retains its assigned port");
                *state
                    .configuration
                    .lock()
                    .expect("runtime configuration lock poisoned") =
                    Some(sidecar_runtime_configuration(port, supervisor.credential()));
                if let Err(message) = ensure_in_process_mcp(&state, supervisor) {
                    result = Err(SupervisorError {
                        service: "mcp".to_owned(),
                        kind: supervisor::FailureKind::Crash,
                        message,
                    });
                }
            }
            (result, supervisor.log_path().to_path_buf())
        }
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
pub(crate) async fn desktop_pick_folder(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
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
pub(crate) fn desktop_preflight_report() -> discovery::PreflightReport {
    discovery::preflight_report()
}

/// Approve one explicit path only for a named supported tool. Rust validates
/// it before writing, and the command deliberately accepts no argv or shell.
#[tauri::command]
pub(crate) fn desktop_approve_executable_path(
    tool: discovery::SupportedTool,
    path: String,
) -> Result<discovery::ToolDiagnostic, String> {
    discovery::approve_executable_path(tool, PathBuf::from(path))
}
