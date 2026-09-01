//! Stable-channel update actions exposed through narrow desktop commands.

mod contract;
mod operation;

use std::env;

use tauri::Emitter;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

use contract::{AppUpdateCheckError, AppUpdateOperationError};
use operation::{AvailableUpdate, ProgressAccumulator};

const UPDATE_PROGRESS_EVENT: &str = "desktop-update-progress";

fn map_updater_error(error: UpdaterError) -> AppUpdateCheckError {
    match error {
        UpdaterError::Reqwest(error) if error.is_decode() => {
            AppUpdateCheckError::invalid_manifest()
        }
        UpdaterError::Reqwest(_) | UpdaterError::Network(_) | UpdaterError::ReleaseNotFound => {
            AppUpdateCheckError::feed_unreachable()
        }
        UpdaterError::EmptyEndpoints
        | UpdaterError::Semver(_)
        | UpdaterError::Serialization(_)
        | UpdaterError::UrlParse(_)
        | UpdaterError::TargetNotFound(_)
        | UpdaterError::TargetsNotFound(_) => AppUpdateCheckError::invalid_manifest(),
        _ => AppUpdateCheckError::check_failed(),
    }
}

fn map_install_error(error: UpdaterError) -> AppUpdateOperationError {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            AppUpdateOperationError::invalid_signature()
        }
        UpdaterError::Reqwest(_) | UpdaterError::Network(_) | UpdaterError::Io(_) => {
            AppUpdateOperationError::download_failed()
        }
        _ => AppUpdateOperationError::operation_failed(),
    }
}

fn configured_updater(
    app: &tauri::AppHandle,
) -> Result<tauri_plugin_updater::Updater, UpdaterError> {
    let mut updater = app.updater_builder();
    if let Ok(update_feed) = env::var("TICKETRY_UPDATE_FEED_URL") {
        updater = updater.endpoints(vec![tauri::Url::parse(&update_feed)?])?;
    }
    updater.build()
}

#[tauri::command]
pub(crate) async fn desktop_update_check(
    app: tauri::AppHandle,
) -> Result<contract::AppUpdateCheckResponse, AppUpdateCheckError> {
    let installed_version = app.package_info().version.to_string();
    operation::check_with(installed_version, || async move {
        let update = configured_updater(&app)
            .map_err(map_updater_error)?
            .check()
            .await
            .map_err(map_updater_error)?;
        Ok(update.map(|update| AvailableUpdate {
            version: update.version,
            notes: update.body,
        }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn desktop_update_download_and_install(
    app: tauri::AppHandle,
) -> Result<(), AppUpdateOperationError> {
    let update = configured_updater(&app)
        .map_err(map_install_error)?
        .check()
        .await
        .map_err(map_install_error)?
        .ok_or_else(AppUpdateOperationError::operation_failed)?;
    let progress_app = app.clone();
    let mut progress = ProgressAccumulator::default();

    update
        .download_and_install(
            move |chunk_bytes, total_bytes| {
                let payload = progress.record_chunk(chunk_bytes, total_bytes);
                let _ = progress_app.emit(UPDATE_PROGRESS_EVENT, payload);
            },
            || {},
        )
        .await
        .map_err(map_install_error)
}

#[tauri::command]
pub(crate) fn desktop_update_restart(app: tauri::AppHandle) {
    // request_restart emits RunEvent::Exit. desktop::run handles that event by
    // shutting down every Rust runtime and releasing data-directory ownership
    // before Tauri launches the updated binary.
    app.request_restart();
}
