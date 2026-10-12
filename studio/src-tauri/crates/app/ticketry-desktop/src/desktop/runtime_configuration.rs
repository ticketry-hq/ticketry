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
    /// The live planner listener. Absent until the runtime is ready, and always
    /// absent in editions without sprint planning, which open no listener.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planner_endpoint: Option<ticketry_planner::PlannerEndpoint>,
    /// The edition this binary was compiled as ("pocock" or "core"). It is
    /// informational, published so e2e suites can assert which edition they
    /// drive; the frontend never gates behavior on it.
    pub edition: &'static str,
}

pub fn development_runtime_configuration() -> Result<RuntimeStartupConfiguration, String> {
    Ok(rust_runtime_configuration())
}

pub fn rust_runtime_configuration() -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        runtime_instance: ticketry_diagnostics::runtime_instance().to_owned(),
        service_health: ServiceHealth::ready(),
        initial_notices: Vec::new(),
        planner_endpoint: None,
        edition: ticketry_edition::EDITION.name(),
    }
}

pub fn failed_runtime_configuration(health: ServiceHealth) -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        runtime_instance: ticketry_diagnostics::runtime_instance().to_owned(),
        service_health: health,
        initial_notices: Vec::new(),
        planner_endpoint: None,
        edition: ticketry_edition::EDITION.name(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::service_health::ServiceHealthState;
    use ticketry_edition::Edition;

    /// The edition literal the specification promises for this build, spelled
    /// independently of `Edition::name` so a renamed edition fails here.
    fn expected_edition_literal() -> &'static str {
        match ticketry_edition::EDITION {
            Edition::Pocock => "pocock",
            Edition::Core => "core",
        }
    }

    fn published_edition(configuration: &RuntimeStartupConfiguration) -> serde_json::Value {
        let published = serde_json::to_value(configuration).expect("serialize configuration");
        published
            .get("edition")
            .cloned()
            .expect("published configuration names its edition")
    }

    #[test]
    fn ready_configuration_publishes_the_compiled_edition() {
        let configuration = rust_runtime_configuration();
        assert_eq!(
            published_edition(&configuration),
            serde_json::json!(expected_edition_literal())
        );
    }

    #[test]
    fn failed_startup_configuration_publishes_the_compiled_edition() {
        let health = ServiceHealth::failed_runtime(
            "startup failed".to_owned(),
            std::path::Path::new("/tmp/ticketry.log"),
        );
        let configuration = failed_runtime_configuration(health);
        assert_eq!(
            published_edition(&configuration),
            serde_json::json!(expected_edition_literal())
        );
    }

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
