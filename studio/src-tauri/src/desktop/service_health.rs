//! The service-health contract Studio renders on its startup gate.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // `degraded` is reserved for lazy MCP capability failures.
pub(crate) enum ServiceHealthState {
    Starting,
    Migrating,
    Ready,
    Recovering,
    Degraded,
    Failed,
}

/// Stable desktop-facing state for the in-process runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceHealth {
    pub(crate) state: ServiceHealthState,
    pub(crate) service: Option<String>,
    pub(crate) message: Option<String>,
    pub(crate) log_pointer: Option<String>,
}

impl ServiceHealth {
    pub(crate) fn starting() -> Self {
        Self {
            state: ServiceHealthState::Starting,
            service: Some("runtime".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn migrating() -> Self {
        Self {
            state: ServiceHealthState::Migrating,
            service: Some("runtime".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn ready() -> Self {
        Self {
            state: ServiceHealthState::Ready,
            service: Some("runtime".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn recovering() -> Self {
        Self {
            state: ServiceHealthState::Recovering,
            service: Some("runtime".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn failed_runtime(message: String, log_path: &Path) -> Self {
        Self {
            state: ServiceHealthState::Failed,
            service: Some("runtime".to_owned()),
            message: Some(message),
            log_pointer: Some(log_path.display().to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_health_points_to_the_application_log_without_expanding_its_shape() {
        let log_path = std::env::temp_dir().join("ticketry.log");
        let health = ServiceHealth::failed_runtime("startup failed".to_owned(), &log_path);
        let value = serde_json::to_value(&health).expect("serialize service health");

        assert_eq!(
            health.log_pointer.as_deref(),
            log_path.to_str(),
            "the failure pointer is the real filesystem path"
        );
        assert!(log_path.is_absolute());
        assert_eq!(
            value
                .as_object()
                .expect("service health object")
                .keys()
                .collect::<Vec<_>>(),
            vec!["logPointer", "message", "service", "state"]
        );
        assert!(value.get("port").is_none());
        assert!(value.get("exitCode").is_none());
        assert!(value.get("processName").is_none());
    }
}
