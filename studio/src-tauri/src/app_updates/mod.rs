//! Stable-channel update checks exposed through one narrow desktop command.

mod contract;
mod operation;

use std::env;

use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

use contract::AppUpdateCheckError;
use operation::AvailableUpdate;

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

#[tauri::command]
pub(crate) async fn desktop_update_check(
    app: tauri::AppHandle,
) -> Result<contract::AppUpdateCheckResponse, AppUpdateCheckError> {
    let installed_version = app.package_info().version.to_string();
    let mut updater = app.updater_builder();

    if let Ok(update_feed) = env::var("TICKETRY_UPDATE_FEED_URL") {
        let endpoint =
            tauri::Url::parse(&update_feed).map_err(|_| AppUpdateCheckError::invalid_manifest())?;
        updater = updater
            .endpoints(vec![endpoint])
            .map_err(map_updater_error)?;
    }

    operation::check_with(installed_version, || async move {
        let update = updater
            .build()
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
