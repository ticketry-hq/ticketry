use std::future::Future;

use super::contract::{AppUpdateCheckResponse, AppUpdateStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AvailableUpdate {
    pub(crate) version: String,
    pub(crate) notes: Option<String>,
}

pub(crate) async fn check_with<F, Fut, E>(
    installed_version: String,
    check: F,
) -> Result<AppUpdateCheckResponse, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<AvailableUpdate>, E>>,
{
    match check().await? {
        None => Ok(AppUpdateCheckResponse {
            installed_version,
            status: AppUpdateStatus::Current,
            available_version: None,
            notes: None,
        }),
        Some(update) => Ok(AppUpdateCheckResponse {
            installed_version,
            status: AppUpdateStatus::Available,
            available_version: Some(update.version),
            notes: update.notes,
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use axum::{http::StatusCode, routing::get, Router};
    use serde_json::json;

    use super::super::{map_install_error, map_updater_error, AppUpdateCheckError};
    use super::*;

    #[tokio::test]
    async fn one_update_check_contacts_the_fixture_feed_once() {
        let request_count = Arc::new(AtomicUsize::new(0));
        let counted_requests = Arc::clone(&request_count);
        let feed = Router::new().route(
            "/latest.json",
            get(move || {
                let counted_requests = Arc::clone(&counted_requests);
                async move {
                    counted_requests.fetch_add(1, Ordering::SeqCst);
                    StatusCode::NO_CONTENT
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind update feed fixture");
        let feed_url = format!(
            "http://{}/latest.json",
            listener.local_addr().expect("read fixture address")
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, feed)
                .await
                .expect("serve update feed fixture");
        });

        let response = check_with("0.2.0".to_owned(), || async move {
            reqwest::get(feed_url).await?.error_for_status()?;
            Ok::<_, reqwest::Error>(None)
        })
        .await
        .expect("update check response");

        assert_eq!(response.status, AppUpdateStatus::Current);
        assert_eq!(request_count.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[tokio::test]
    async fn update_check_reports_the_installed_version_when_the_stable_channel_is_current() {
        let response = check_with("0.2.0".to_owned(), || async {
            Ok::<_, std::convert::Infallible>(None)
        })
        .await
        .expect("update check response");

        assert_eq!(
            serde_json::to_value(response).expect("serialize response"),
            json!({
                "installed_version": "0.2.0",
                "status": "current"
            })
        );
    }

    #[tokio::test]
    async fn update_check_reports_the_available_version_and_release_notes() {
        let response = check_with("0.2.0".to_owned(), || async {
            Ok::<_, std::convert::Infallible>(Some(AvailableUpdate {
                version: "0.3.0".to_owned(),
                notes: Some("Faster project switching.".to_owned()),
            }))
        })
        .await
        .expect("update check response");

        assert_eq!(
            serde_json::to_value(response).expect("serialize response"),
            json!({
                "installed_version": "0.2.0",
                "status": "available",
                "available_version": "0.3.0",
                "notes": "Faster project switching."
            })
        );
    }

    #[test]
    fn unavailable_update_feed_errors_are_retryable() {
        assert_eq!(
            map_updater_error(tauri_plugin_updater::Error::ReleaseNotFound),
            AppUpdateCheckError::feed_unreachable()
        );
    }

    #[test]
    fn malformed_update_manifest_errors_are_retryable() {
        let source = serde_json::from_str::<serde_json::Value>("{")
            .expect_err("fixture must be invalid JSON");

        assert_eq!(
            map_updater_error(tauri_plugin_updater::Error::Serialization(source)),
            AppUpdateCheckError::invalid_manifest()
        );
    }

    #[test]
    fn invalid_updater_signature_is_rejected_without_retrying_the_same_archive() {
        let malformed_signature = base64::decode("!").expect_err("fixture must be invalid base64");

        assert_eq!(
            map_install_error(tauri_plugin_updater::Error::Base64(malformed_signature)),
            Some(super::super::contract::AppUpdateInstallError::invalid_signature())
        );
    }
}
