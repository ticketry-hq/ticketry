//! Every desktop capability the webview may invoke. Each command names its
//! own authority: the main window only, no caller-supplied program, path,
//! port, or environment value.

pub mod terminal_viewer;

use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

use crate::desktop::folder_selection::absolute_folder_path;
use crate::desktop::frontend_log::{append_frontend_log, frontend_log_line};
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;
use crate::desktop::runtime_configuration::RuntimeStartupConfiguration;
use crate::desktop::service_state::DesktopServiceState;
use ticketry_tool_discovery as discovery;

use serde::Serialize;

#[tauri::command]
pub fn desktop_runtime_configuration(
    state: tauri::State<'_, DesktopServiceState>,
) -> Result<RuntimeStartupConfiguration, String> {
    state.configuration()
}

#[tauri::command]
pub async fn desktop_launch_default_coding_agent(
    window: tauri::WebviewWindow,
    issue_id: String,
    services: tauri::State<'_, DesktopServiceState>,
    launch: tauri::State<'_, DesktopLaunchRuntime>,
) -> Result<serde_json::Value, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("agent launch is restricted to the local main window".to_owned());
    }
    // Reuse the pool composition already opened. A pool per click would
    // re-run the launch-policy DDL and take an exclusive write lock on a
    // `state.db` several writers are already sharing.
    let database = launch.commands()?;
    let resolver =
        ticketry_work_management::work_management::launch_policy::LaunchPolicyResolver::new(
            database.clone(),
        );
    let decision = resolver
        .resolve(ticketry_work_management::work_management::launch_policy::LaunchPolicyRequest {
            task_id: issue_id,
            destination_state_id: None,
            provider_override: None,
            caller_scope: ticketry_work_management::work_management::launch_policy::CallerScope::Interactive,
            idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
        })
        .await
        .map_err(|error| error.code().to_owned())?;
    let decision =
        ticketry_work_management::work_management::launch_policy::record(database, &decision)
            .await
            .map_err(|error| error.code().to_owned())?;
    let terminal_launch = services
        .terminal_launch
        .lock()
        .expect("terminal launch lock poisoned")
        .clone()
        .ok_or_else(|| "terminal launch is unavailable".to_owned())?;
    let session = ticketry_agent_execution::execution::launch_delivery::execute(
        database,
        &terminal_launch,
        &decision,
    )
    .await?;
    Ok(serde_json::json!({ "agent_run_id": session.agent_run_id }))
}

/// Bridge from the local main webview to the optional process log.
#[tauri::command]
pub fn desktop_append_frontend_log(
    window: tauri::WebviewWindow,
    _state: tauri::State<'_, DesktopServiceState>,
    log: tauri::State<'_, ticketry_diagnostics::FileLog>,
    level: String,
    message: String,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("frontend logs are restricted to the local main window".to_owned());
    }
    let line = frontend_log_line(&level, &message)?;
    append_frontend_log(&log, &line)
}

#[tauri::command]
pub fn desktop_file_logging_enabled(
    window: tauri::WebviewWindow,
    log: tauri::State<'_, ticketry_diagnostics::FileLog>,
) -> Result<bool, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("file logging status is restricted to the local main window".to_owned());
    }
    Ok(log.is_enabled())
}

/// A startup failure is retried by restarting the one in-process runtime.
#[tauri::command]
pub fn desktop_retry_services(
    _application: tauri::AppHandle,
    _state: tauri::State<'_, DesktopServiceState>,
) -> Result<(), String> {
    Err(
        "Ticketry's in-process runtime could not recover; restart the application to retry startup"
            .to_owned(),
    )
}

/// Open one directory-only native chooser parented to the local main window.
/// The webview receives only the selected absolute path or cancellation.
#[tauri::command]
pub async fn desktop_pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
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

#[derive(Serialize)]
pub struct ModuleFolderValidation {
    valid: bool,
    reason: Option<&'static str>,
}

/// Validate a user-selected local folder without exposing a general filesystem
/// command to the webview.
#[tauri::command]
pub fn desktop_validate_module_folder(path: String) -> ModuleFolderValidation {
    match ticketry_work_management::module_links::folder_preflight::validate_configured(Some(&path))
    {
        Ok(_) => ModuleFolderValidation {
            valid: true,
            reason: None,
        },
        Err(error) => {
            let reason = match error {
                ticketry_work_management::module_links::folder_preflight::ModuleFolderFailure::Relative
                | ticketry_work_management::module_links::folder_preflight::ModuleFolderFailure::Unset => {
                    "module_folder_not_absolute"
                }
                ticketry_work_management::module_links::folder_preflight::ModuleFolderFailure::Missing
                | ticketry_work_management::module_links::folder_preflight::ModuleFolderFailure::Inaccessible => {
                    "module_folder_missing"
                }
                ticketry_work_management::module_links::folder_preflight::ModuleFolderFailure::NotDirectory => {
                    "module_folder_not_a_directory"
                }
            };
            ModuleFolderValidation {
                valid: false,
                reason: Some(reason),
            }
        }
    }
}

/// Read-only, zero-argument preflight.  The webview can request the fixed
/// report but cannot name a program, path, argument, or environment value.
#[tauri::command]
pub fn desktop_preflight_report() -> discovery::PreflightReport {
    discovery::preflight_report()
}

/// Approve one explicit path only for a named supported tool. Rust validates
/// it before writing, and the command deliberately accepts no argv or shell.
#[tauri::command]
pub fn desktop_approve_executable_path(
    tool: discovery::SupportedTool,
    path: String,
) -> Result<discovery::ToolDiagnostic, String> {
    discovery::approve_executable_path(tool, PathBuf::from(path))
}
