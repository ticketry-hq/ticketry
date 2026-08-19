//! The complete runtime contract Studio reads once at startup: where to reach
//! the backend, the per-launch credential, current health, and any notices
//! raised before the webview could listen for events.

use serde::Serialize;

use crate::desktop::environment::{endpoint, optional_value};
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::user_notices::UserNotice;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeEndpoints {
    pub(crate) work_tracker_api: String,
    pub(crate) agent_api: String,
    pub(crate) status_api: String,
    pub(crate) terminal_web_socket: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeValues {
    pub(crate) work_tracker_api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStartupConfiguration {
    pub(crate) endpoints: RuntimeEndpoints,
    pub(crate) values: RuntimeValues,
    pub(crate) service_health: ServiceHealth,
    pub(crate) initial_notices: Vec<UserNotice>,
}

fn default_runtime_endpoints() -> RuntimeEndpoints {
    // This is deliberately development-only. Packaged endpoints come from the
    // ready supervisor and must never fall back to a fixed backend port.
    let port = "5174";
    let http_origin = format!("http://127.0.0.1:{port}");
    let web_socket_origin = format!("ws://127.0.0.1:{port}");

    RuntimeEndpoints {
        work_tracker_api: format!("{http_origin}/api/work-tracker"),
        agent_api: format!("{http_origin}/api"),
        status_api: format!("{http_origin}/api"),
        terminal_web_socket: format!("{web_socket_origin}/ws/terminal"),
    }
}

pub(crate) fn development_runtime_configuration() -> Result<RuntimeStartupConfiguration, String> {
    let defaults = default_runtime_endpoints();

    Ok(RuntimeStartupConfiguration {
        endpoints: RuntimeEndpoints {
            work_tracker_api: endpoint(
                "MUXED_DESKTOP_WORKTRACKER_API",
                &defaults.work_tracker_api,
            )?,
            agent_api: endpoint("MUXED_DESKTOP_AGENT_API", &defaults.agent_api)?,
            status_api: endpoint("MUXED_DESKTOP_STATUS_API", &defaults.status_api)?,
            terminal_web_socket: endpoint(
                "MUXED_DESKTOP_TERMINAL_WEBSOCKET",
                &defaults.terminal_web_socket,
            )?,
        },
        values: RuntimeValues {
            work_tracker_api_key: optional_value("MUXED_DESKTOP_WORKTRACKER_API_KEY")?,
        },
        service_health: ServiceHealth::ready(),
        initial_notices: Vec::new(),
    })
}

pub(crate) fn sidecar_runtime_configuration(
    port: u16,
    credential: &str,
) -> RuntimeStartupConfiguration {
    let http_origin = format!("http://127.0.0.1:{port}");
    let web_socket_origin = format!("ws://127.0.0.1:{port}");
    RuntimeStartupConfiguration {
        endpoints: RuntimeEndpoints {
            work_tracker_api: format!("{http_origin}/api/work-tracker"),
            agent_api: format!("{http_origin}/api"),
            status_api: format!("{http_origin}/api"),
            terminal_web_socket: format!("{web_socket_origin}/ws/terminal"),
        },
        values: RuntimeValues {
            work_tracker_api_key: credential.to_owned(),
        },
        service_health: ServiceHealth::ready(),
        initial_notices: Vec::new(),
    }
}

pub(crate) fn failed_runtime_configuration(health: ServiceHealth) -> RuntimeStartupConfiguration {
    // The frontend requires a complete, loopback-only runtime contract before
    // it can render the service-health gate. Port 1 is deliberately unusable;
    // failed health prevents these placeholders from being consumed as a
    // functioning backend.
    let mut configuration = sidecar_runtime_configuration(1, "");
    configuration.service_health = health;
    configuration
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_health::ServiceHealthState;
    use crate::supervisor::{self, SupervisorError};
    use std::path::Path;

    #[test]
    fn startup_failure_configuration_renders_health_without_a_live_backend() {
        let health = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Crash,
                message: "packaged skill collision".to_owned(),
            },
            Path::new("/tmp/ticketry/sidecar.log"),
        );
        let configuration = failed_runtime_configuration(health.clone());

        assert_eq!(configuration.service_health, health);
        assert_eq!(
            configuration.endpoints.work_tracker_api,
            "http://127.0.0.1:1/api/work-tracker"
        );
        assert!(configuration.values.work_tracker_api_key.is_empty());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_defaults_use_the_vite_proxy() {
        let endpoints = default_runtime_endpoints();

        assert_eq!(
            endpoints.work_tracker_api,
            "http://127.0.0.1:5174/api/work-tracker"
        );
        assert_eq!(endpoints.agent_api, "http://127.0.0.1:5174/api");
        assert_eq!(endpoints.status_api, "http://127.0.0.1:5174/api");
        assert_eq!(
            endpoints.terminal_web_socket,
            "ws://127.0.0.1:5174/ws/terminal"
        );
    }

    #[test]
    fn sidecar_configuration_uses_the_assigned_port_and_credential() {
        let configuration = sidecar_runtime_configuration(43_219, "per-launch-credential");

        assert_eq!(
            configuration.endpoints.work_tracker_api,
            "http://127.0.0.1:43219/api/work-tracker"
        );
        assert_eq!(
            configuration.values.work_tracker_api_key,
            "per-launch-credential"
        );
        assert_eq!(
            configuration.service_health.state,
            ServiceHealthState::Ready
        );
        assert!(configuration.initial_notices.is_empty());
        assert_eq!(
            serde_json::to_value(configuration)
                .expect("serialize runtime configuration")
                .get("initialNotices"),
            Some(&serde_json::json!([]))
        );
    }
}
