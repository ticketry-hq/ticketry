//! Stable-channel updates: the check, the user-requested install, and the
//! restart into the installed version, each a narrow desktop command.

pub(crate) mod acceptance;
mod contract;
pub(crate) mod install;
mod operation;

use std::env;

use tauri_plugin_updater::{Error as UpdaterError, Updater, UpdaterExt};

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

/// The one updater every update operation goes through.
///
/// `TICKETRY_UPDATE_FEED_URL` replaces the packaged stable channel endpoint so
/// acceptance runs can serve a locally signed release; without it the packaged
/// feed in `tauri.conf.json` is the only endpoint.
fn stable_channel_updater(app: &tauri::AppHandle) -> Result<Updater, AppUpdateCheckError> {
    let mut updater = app.updater_builder();

    if let Ok(update_feed) = env::var("TICKETRY_UPDATE_FEED_URL") {
        let endpoint =
            tauri::Url::parse(&update_feed).map_err(|_| AppUpdateCheckError::invalid_manifest())?;
        updater = updater
            .endpoints(vec![endpoint])
            .map_err(map_updater_error)?;
    }

    updater.build().map_err(map_updater_error)
}

#[tauri::command]
pub async fn desktop_update_check(
    app: tauri::AppHandle,
) -> Result<contract::AppUpdateCheckResponse, AppUpdateCheckError> {
    let installed_version = app.package_info().version.to_string();
    let updater = stable_channel_updater(&app)?;

    operation::check_with(installed_version, || async move {
        let update = updater.check().await.map_err(map_updater_error)?;
        Ok(update.map(|update| AvailableUpdate {
            version: update.version,
            notes: update.body,
        }))
    })
    .await
}
