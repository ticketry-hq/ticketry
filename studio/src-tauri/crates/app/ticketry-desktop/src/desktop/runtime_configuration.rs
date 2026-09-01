//! Startup state published by the in-process desktop runtime.

use serde::Serialize;

use crate::desktop::service_health::ServiceHealth;
use crate::desktop::user_notices::UserNotice;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStartupConfiguration {
    pub runtime_instance: String,
    pub service_health: ServiceHealth,
    pub initial_notices: Vec<UserNotice>,
}

pub fn development_runtime_configuration() -> Result<RuntimeStartupConfiguration, String> {
    Ok(rust_runtime_configuration())
}

pub fn rust_runtime_configuration() -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        runtime_instance: ticketry_diagnostics::runtime_instance().to_owned(),
        service_health: ServiceHealth::ready(),
        initial_notices: Vec::new(),
    }
}

pub fn failed_runtime_configuration(health: ServiceHealth) -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        runtime_instance: ticketry_diagnostics::runtime_instance().to_owned(),
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
        assert_eq!(
            configuration.service_health.state,
            ServiceHealthState::Failed
        );
        assert!(configuration.initial_notices.is_empty());
    }

    #[test]
    fn development_uses_the_same_in_process_contract() {
        let configuration = development_runtime_configuration().expect("development runtime");
        assert_eq!(configuration, rust_runtime_configuration());
        assert!(!configuration.runtime_instance.is_empty());
        assert_eq!(
            configuration.runtime_instance,
            rust_runtime_configuration().runtime_instance
        );
    }
}
