//! Startup state published by the in-process desktop runtime.

use serde::Serialize;

use crate::desktop::service_health::ServiceHealth;
use crate::desktop::user_notices::UserNotice;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStartupConfiguration {
    pub(crate) service_health: ServiceHealth,
    pub(crate) initial_notices: Vec<UserNotice>,
}

pub(crate) fn development_runtime_configuration() -> Result<RuntimeStartupConfiguration, String> {
    Ok(rust_runtime_configuration())
}

pub(crate) fn rust_runtime_configuration() -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        service_health: ServiceHealth::ready(),
        initial_notices: Vec::new(),
    }
}

pub(crate) fn failed_runtime_configuration(health: ServiceHealth) -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        service_health: health,
        initial_notices: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_health::ServiceHealthState;

    #[test]
    fn startup_failure_configuration_needs_no_network_contract() {
        let health = ServiceHealth::failed_runtime(
            "startup failed".to_owned(),
            std::path::Path::new("/tmp/ticketry.log"),
        );
        let configuration = failed_runtime_configuration(health.clone());
        assert_eq!(configuration.service_health, health);
        assert_eq!(configuration.service_health.state, ServiceHealthState::Failed);
        assert!(configuration.initial_notices.is_empty());
    }

    #[test]
    fn development_uses_the_same_in_process_contract() {
        let configuration = development_runtime_configuration().expect("development runtime");
        assert_eq!(configuration, rust_runtime_configuration());
    }
}
