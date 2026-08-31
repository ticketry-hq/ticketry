//! Downloading, installing, and restarting into a stable channel update.
//!
//! Installation only ever runs because the user asked for it in Settings. The
//! archive signature is verified before anything is written, and the restart
//! goes through the same teardown as a normal exit so the relaunched process
//! inherits a released data-directory lock and no stranded child processes.

use std::sync::Mutex;

use tauri::Emitter;
use tauri_plugin_updater::Error as UpdaterError;

use super::contract::{AppUpdateOperationError, AppUpdateProgress};

/// The one webview event carrying download progress for the in-flight update.
pub const UPDATE_PROGRESS_EVENT: &str = "desktop-update-progress";

/// Bytes received so far, plus the total once the feed declares one.
///
/// The updater reports chunk lengths, not totals, and a feed that omits
/// `Content-Length` never declares one — that is the indeterminate branch the
/// Settings progress UI renders without a percentage.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DownloadProgress {
    received_bytes: u64,
    total_bytes: Option<u64>,
}

impl DownloadProgress {
    pub fn record(
        &mut self,
        chunk_length: usize,
        content_length: Option<u64>,
    ) -> AppUpdateProgress {
        self.received_bytes = self.received_bytes.saturating_add(chunk_length as u64);
        if let Some(total_bytes) = content_length {
            self.total_bytes = Some(total_bytes);
        }
        AppUpdateProgress {
            received_bytes: self.received_bytes,
            total_bytes: self.total_bytes,
        }
    }
}

/// Classifies an install failure the shell reports under its own contract.
///
/// Signature rejection is terminal — the downloaded archive is discarded
/// rather than retried. Transport failures are retryable, and anything else
/// stays a retryable generic failure rather than inventing a code.
pub fn map_operation_error(error: UpdaterError) -> AppUpdateOperationError {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            AppUpdateOperationError::signature_invalid()
        }
        UpdaterError::Reqwest(_) | UpdaterError::Network(_) | UpdaterError::ReleaseNotFound => {
            AppUpdateOperationError::download_failed()
        }
        _ => AppUpdateOperationError::operation_failed(),
    }
}

#[tauri::command]
pub async fn desktop_update_download_and_install(
    app: tauri::AppHandle,
) -> Result<(), AppUpdateOperationError> {
    let updater = super::stable_channel_updater(&app)
        .map_err(|_| AppUpdateOperationError::download_failed())?;
    let update = updater
        .check()
        .await
        .map_err(map_operation_error)?
        .ok_or_else(AppUpdateOperationError::operation_failed)?;

    let progress = Mutex::new(DownloadProgress::default());
    let emitter = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let payload = progress
                    .lock()
                    .expect("update download progress lock poisoned")
                    .record(chunk_length, content_length);
                let _ = emitter.emit(UPDATE_PROGRESS_EVENT, payload);
            },
            || {},
        )
        .await
        .map_err(map_operation_error)
}

/// Restarts into the installed update after the ordinary exit teardown.
pub fn restart_into_update(app: &tauri::AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        crate::desktop::lifecycle::tear_down_before_exit(&handle);
        handle.restart();
    }) {
        eprintln!("Ticketry could not restart into the installed update: {error}");
    }
}

#[tauri::command]
pub fn desktop_update_restart(app: tauri::AppHandle) {
    restart_into_update(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_accumulates_chunks_and_keeps_the_declared_total() {
        let mut progress = DownloadProgress::default();

        assert_eq!(
            progress.record(1_024, Some(4_096)),
            AppUpdateProgress {
                received_bytes: 1_024,
                total_bytes: Some(4_096),
            }
        );
        assert_eq!(
            progress.record(3_072, Some(4_096)),
            AppUpdateProgress {
                received_bytes: 4_096,
                total_bytes: Some(4_096),
            }
        );
    }

    #[test]
    fn progress_stays_indeterminate_while_the_feed_declares_no_total() {
        let mut progress = DownloadProgress::default();

        assert_eq!(
            progress.record(512, None),
            AppUpdateProgress {
                received_bytes: 512,
                total_bytes: None,
            }
        );
        assert_eq!(
            progress.record(512, None),
            AppUpdateProgress {
                received_bytes: 1_024,
                total_bytes: None,
            }
        );
    }

    #[test]
    fn a_total_declared_mid_download_applies_to_the_bytes_already_received() {
        let mut progress = DownloadProgress::default();
        progress.record(256, None);

        assert_eq!(
            progress.record(256, Some(1_024)),
            AppUpdateProgress {
                received_bytes: 512,
                total_bytes: Some(1_024),
            }
        );
    }

    #[test]
    fn signature_rejection_is_never_retried_while_transport_failures_are() {
        assert_eq!(
            map_operation_error(UpdaterError::SignatureUtf8("not base64".to_owned())),
            AppUpdateOperationError::signature_invalid()
        );
        assert_eq!(
            map_operation_error(UpdaterError::Network("connection reset".to_owned())),
            AppUpdateOperationError::download_failed()
        );
        assert_eq!(
            map_operation_error(UpdaterError::ReleaseNotFound),
            AppUpdateOperationError::download_failed()
        );
        assert_eq!(
            map_operation_error(UpdaterError::UnsupportedOs),
            AppUpdateOperationError::operation_failed()
        );
    }

    #[test]
    fn a_signature_that_is_not_valid_base64_is_rejected_the_same_way() {
        let malformed_signature =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, "!")
                .expect_err("fixture must be invalid base64");

        assert_eq!(
            map_operation_error(UpdaterError::Base64(malformed_signature)),
            AppUpdateOperationError::signature_invalid()
        );
    }
}
