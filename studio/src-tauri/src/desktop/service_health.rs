//! The service-health contract Studio renders on its startup gate.

use serde::Serialize;
use std::path::Path;

use crate::sidecar_supervision::{self, SupervisorError};

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

/// Stable desktop-facing state. Process names and exits stay inside the
/// supervisor; Studio only receives this small, actionable contract.
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
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn migrating() -> Self {
        Self {
            state: ServiceHealthState::Migrating,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn ready() -> Self {
        Self {
            state: ServiceHealthState::Ready,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn recovering() -> Self {
        Self {
            state: ServiceHealthState::Recovering,
            service: Some("backend".to_owned()),
            message: None,
            log_pointer: None,
        }
    }

    pub(crate) fn failed(error: &SupervisorError, log_path: &Path) -> Self {
        let message = match error.kind {
            sidecar_supervision::FailureKind::Migration => {
                "The state database could not be migrated.".to_owned()
            }
            _ => error.message.clone(),
        };
        Self {
            state: ServiceHealthState::Failed,
            service: Some(error.service.clone()),
            message: Some(message),
            log_pointer: Some(log_path.display().to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn failed_health_points_to_the_real_sidecar_log_without_expanding_its_shape() {
        let log_path = env::temp_dir().join("muxed-sidecar.log");
        let error = SupervisorError {
            service: "backend".to_owned(),
            kind: sidecar_supervision::FailureKind::Crash,
            message: "restart allowance exhausted".to_owned(),
        };

        let health = ServiceHealth::failed(&error, &log_path);
        let value = serde_json::to_value(&health).expect("serialize service health");

        assert_eq!(
            health.log_pointer.as_deref(),
            log_path.to_str(),
            "the give-up pointer is the real filesystem path"
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

    #[test]
    fn migration_failure_health_names_the_database_without_changing_its_shape() {
        let log_path = env::temp_dir().join("muxed-sidecar.log");
        let health = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: sidecar_supervision::FailureKind::Migration,
                message: "internal migration detail".to_owned(),
            },
            &log_path,
        );

        assert_eq!(health.state, ServiceHealthState::Failed);
        assert_eq!(health.service.as_deref(), Some("backend"));
        assert_eq!(
            health.message.as_deref(),
            Some("The state database could not be migrated.")
        );
        assert_eq!(health.log_pointer.as_deref(), log_path.to_str());
    }
}
