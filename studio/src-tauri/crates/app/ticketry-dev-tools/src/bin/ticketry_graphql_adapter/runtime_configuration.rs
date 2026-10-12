//! Read-only runtime configuration the browser development adapter publishes.

use axum::{
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Serialize;

/// Where the adapter publishes its runtime configuration.
pub(super) const RUNTIME_CONFIGURATION_PATH: &str = "/runtime-configuration";

/// What the adapter reports about the binary serving the browser runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AdapterRuntimeConfiguration {
    /// The edition this binary was compiled as ("pocock" or "core"). It is
    /// informational, published so e2e suites can assert which edition they
    /// drive; the frontend never gates behavior on it.
    edition: &'static str,
}

impl AdapterRuntimeConfiguration {
    /// The configuration of this compiled adapter.
    pub(super) fn compiled() -> Self {
        Self {
            edition: ticketry_edition::EDITION.name(),
        }
    }
}

/// The runtime configuration route, mergeable into the adapter's router.
pub(super) fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new().route(RUNTIME_CONFIGURATION_PATH, get(runtime_configuration))
}

async fn runtime_configuration(headers: HeaderMap) -> Response {
    if let Err(reason) = super::local_request_gate(&headers) {
        return (StatusCode::FORBIDDEN, reason).into_response();
    }
    let mut response = Json(AdapterRuntimeConfiguration::compiled()).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use ticketry_edition::Edition;

    use super::*;

    /// The edition literal the specification promises for this build, spelled
    /// independently of `Edition::name` so a renamed edition fails here.
    fn expected_edition_literal() -> &'static str {
        match ticketry_edition::EDITION {
            Edition::Pocock => "pocock",
            Edition::Core => "core",
        }
    }

    async fn serve_routes() -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind runtime configuration listener");
        let address = listener.local_addr().expect("listener address");
        tokio::spawn(async move {
            axum::serve(listener, routes::<()>())
                .await
                .expect("serve runtime configuration");
        });
        address
    }

    #[test]
    fn configuration_publishes_the_compiled_edition() {
        let published = serde_json::to_value(AdapterRuntimeConfiguration::compiled())
            .expect("serialize adapter runtime configuration");
        assert_eq!(
            published,
            serde_json::json!({ "edition": expected_edition_literal() })
        );
    }

    #[tokio::test]
    async fn route_serves_the_compiled_edition_to_loopback_callers() {
        let address = serve_routes().await;
        let response = reqwest::Client::new()
            .get(format!("http://{address}{RUNTIME_CONFIGURATION_PATH}"))
            .header("Origin", "http://127.0.0.1:5174")
            .send()
            .await
            .expect("request runtime configuration");
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(reqwest::header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        let body: serde_json::Value = response.json().await.expect("runtime configuration JSON");
        assert_eq!(
            body,
            serde_json::json!({ "edition": expected_edition_literal() })
        );
    }

    #[tokio::test]
    async fn route_rejects_non_loopback_browser_origins() {
        let address = serve_routes().await;
        let response = reqwest::Client::new()
            .get(format!("http://{address}{RUNTIME_CONFIGURATION_PATH}"))
            .header("Origin", "https://malicious.example")
            .send()
            .await
            .expect("request runtime configuration");
        assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
    }
}
