//! Explicit Gemini folder approval from the local main webview.
use std::path::Path;

use ticketry_launch::{DirectoryTrustOutcome, DirectoryTrustSetup, Provider};

use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;

#[tauri::command]
pub(crate) async fn desktop_prepare_directory_trust(
    window: tauri::WebviewWindow,
    directory: String,
    approved: bool,
) -> Result<&'static str, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("Directory trust setup is restricted to the local main window.".to_owned());
    }
    if !Path::new(&directory).is_absolute() {
        return Err("Select an existing folder with an absolute path and retry.".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        DirectoryTrustSetup::from_environment(Provider::Gemini)
            .and_then(|setup| setup.prepare(Path::new(&directory), approved))
            .map(|outcome| match outcome {
                DirectoryTrustOutcome::Prepared => "prepared",
                DirectoryTrustOutcome::AlreadyTrusted => "already_trusted",
                DirectoryTrustOutcome::Refused => "refused",
            })
            .map_err(|error| {
                format!("Could not trust this folder for Gemini: {error} Check the folder and Gemini trusted-folders configuration, then retry.")
            })
    })
    .await
    .map_err(|error| format!("Directory trust setup stopped: {error}. Retry folder setup."))?
}
