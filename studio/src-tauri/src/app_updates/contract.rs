use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AppUpdateInstallErrorCode {
    UpdateRejectedInvalidSignature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AppUpdateInstallError {
    pub(crate) code: AppUpdateInstallErrorCode,
    pub(crate) message: &'static str,
    pub(crate) retryable: bool,
}

impl AppUpdateInstallError {
    pub(crate) fn invalid_signature() -> Self {
        Self {
            code: AppUpdateInstallErrorCode::UpdateRejectedInvalidSignature,
            message: "Update rejected: invalid signature. Ticketry was not changed. Restore a trusted stable channel update and check again.",
            retryable: false,
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
            serde_json::to_value(AppUpdateInstallError::invalid_signature())
                .expect("serialize update install error"),
            json!({
                "code": "update_rejected_invalid_signature",
                "message": "Update rejected: invalid signature. Ticketry was not changed. Restore a trusted stable channel update and check again.",
                "retryable": false
            })
        );
    }
}
