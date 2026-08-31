use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppUpdateStatus {
    Current,
    Available,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AppUpdateCheckResponse {
    pub(crate) installed_version: String,
    pub(crate) status: AppUpdateStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) available_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AppUpdateCheckErrorCode {
    UpdateFeedUnreachable,
    UpdateManifestInvalid,
    UpdateCheckFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AppUpdateCheckError {
    pub(crate) code: AppUpdateCheckErrorCode,
    pub(crate) message: &'static str,
    pub(crate) retryable: bool,
}

impl AppUpdateCheckError {
    pub(crate) fn feed_unreachable() -> Self {
        Self {
            code: AppUpdateCheckErrorCode::UpdateFeedUnreachable,
            message: "The stable channel update feed could not be reached. Check your connection and retry the update check.",
            retryable: true,
        }
    }

    pub(crate) fn invalid_manifest() -> Self {
        Self {
            code: AppUpdateCheckErrorCode::UpdateManifestInvalid,
            message: "The stable channel update manifest is invalid. Retry the update check later.",
            retryable: true,
        }
    }

    pub(crate) fn check_failed() -> Self {
        Self {
            code: AppUpdateCheckErrorCode::UpdateCheckFailed,
            message: "The stable channel update check failed. Retry the update check.",
            retryable: true,
        }
    }
}

/// Progress of the one in-flight update download, as the webview reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct AppUpdateProgress {
    pub(crate) received_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AppUpdateOperationErrorCode {
    UpdateSignatureInvalid,
    UpdateDownloadFailed,
    UpdateOperationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AppUpdateOperationError {
    pub(crate) code: AppUpdateOperationErrorCode,
    pub(crate) message: &'static str,
    pub(crate) retryable: bool,
}

impl AppUpdateOperationError {
    /// A rejected signature is terminal: the archive is discarded, never
    /// retried, and Ticketry is left exactly as it was.
    pub(crate) fn signature_invalid() -> Self {
        Self {
            code: AppUpdateOperationErrorCode::UpdateSignatureInvalid,
            message: "Update rejected: invalid signature. Ticketry was not changed. Check for updates again once a trusted stable channel release is published.",
            retryable: false,
        }
    }

    pub(crate) fn download_failed() -> Self {
        Self {
            code: AppUpdateOperationErrorCode::UpdateDownloadFailed,
            message:
                "The update download did not finish. Check your connection and retry the update.",
            retryable: true,
        }
    }

    pub(crate) fn operation_failed() -> Self {
        Self {
            code: AppUpdateOperationErrorCode::UpdateOperationFailed,
            message: "The update could not be downloaded or installed. Retry the update.",
            retryable: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn feed_failure_is_actionable_retryable_and_serialized_for_the_webview() {
        assert_eq!(
            serde_json::to_value(AppUpdateCheckError::feed_unreachable())
                .expect("serialize update check error"),
            json!({
                "code": "update_feed_unreachable",
                "message": "The stable channel update feed could not be reached. Check your connection and retry the update check.",
                "retryable": true
            })
        );
    }

    #[test]
    fn invalid_manifest_is_actionable_retryable_and_serialized_for_the_webview() {
        assert_eq!(
            serde_json::to_value(AppUpdateCheckError::invalid_manifest())
                .expect("serialize update check error"),
            json!({
                "code": "update_manifest_invalid",
                "message": "The stable channel update manifest is invalid. Retry the update check later.",
                "retryable": true
            })
        );
    }

    #[test]
    fn signature_rejection_is_distinct_actionable_and_not_retryable_as_is() {
        assert_eq!(
            serde_json::to_value(AppUpdateOperationError::signature_invalid())
                .expect("serialize update operation error"),
            json!({
                "code": "update_signature_invalid",
                "message": "Update rejected: invalid signature. Ticketry was not changed. Check for updates again once a trusted stable channel release is published.",
                "retryable": false
            })
        );
    }

    #[test]
    fn download_and_generic_operation_failures_stay_retryable() {
        assert_eq!(
            serde_json::to_value(AppUpdateOperationError::download_failed())
                .expect("serialize update operation error"),
            json!({
                "code": "update_download_failed",
                "message": "The update download did not finish. Check your connection and retry the update.",
                "retryable": true
            })
        );
        assert_eq!(
            serde_json::to_value(AppUpdateOperationError::operation_failed())
                .expect("serialize update operation error"),
            json!({
                "code": "update_operation_failed",
                "message": "The update could not be downloaded or installed. Retry the update.",
                "retryable": true
            })
        );
    }

    #[test]
    fn download_progress_omits_an_unknown_total_for_the_indeterminate_branch() {
        assert_eq!(
            serde_json::to_value(AppUpdateProgress {
                received_bytes: 2_048,
                total_bytes: Some(8_192),
            })
            .expect("serialize update progress"),
            json!({ "received_bytes": 2_048, "total_bytes": 8_192 })
        );
        assert_eq!(
            serde_json::to_value(AppUpdateProgress {
                received_bytes: 2_048,
                total_bytes: None,
            })
            .expect("serialize update progress"),
            json!({ "received_bytes": 2_048 })
        );
    }
}
