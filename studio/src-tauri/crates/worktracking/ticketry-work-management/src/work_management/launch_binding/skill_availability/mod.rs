//! Which stage skills a launch binding's provider can see (CODING-2722).
//!
//! A read-only observation for the workflow editor. The provider is resolved
//! in the launch order — explicit agent, then a Codex profile, then the global
//! default — and the module-relative roots come from the Module's typed link.
//! Nothing here writes to the database or to any skill directory.

mod graphql;

pub(crate) use graphql::register;

use sea_orm::DatabaseConnection;
use ticketry_provider::{
    check_skill_availability, Provider, SkillAvailabilityReport, SkillAvailabilityRequest,
    SkillSearchEnvironment,
};

use crate::module_links::resolution::usable_folder;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchSkillAvailabilityRequest {
    pub module_id: String,
    /// The binding's agent/provider slug, when one is chosen.
    pub agent: Option<String>,
    /// The binding's Codex profile, when one is chosen.
    pub profile: Option<String>,
    pub names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LaunchSkillAvailability {
    /// Every searched root for the resolved provider was consulted.
    Checked(SkillAvailabilityReport),
    /// No availability fact was established; never a claim that skills exist.
    Unchecked {
        code: &'static str,
        provider: Option<Provider>,
        message: String,
    },
}

/// Observe the requested skills for the provider a launch would use.
pub async fn check_launch_skill_availability(
    database: &DatabaseConnection,
    request: &LaunchSkillAvailabilityRequest,
    environment: &SkillSearchEnvironment,
) -> LaunchSkillAvailability {
    let provider = match resolve_provider(database, request).await {
        Ok(provider) => provider,
        Err((code, message)) => {
            return LaunchSkillAvailability::Unchecked {
                code,
                provider: None,
                message,
            }
        }
    };
    let working_root = match usable_folder(database, &request.module_id).await {
        Ok(folder) => folder,
        Err(refusal) => {
            return LaunchSkillAvailability::Unchecked {
                code: refusal.code(),
                provider: Some(provider),
                message: refusal.message().to_owned(),
            }
        }
    };
    let request = SkillAvailabilityRequest {
        provider,
        working_root: Some(working_root),
        names: request.names.clone(),
        environment: environment.clone(),
    };
    let report = tokio::task::spawn_blocking(move || check_skill_availability(&request)).await;
    match report {
        Ok(report) => LaunchSkillAvailability::Checked(report),
        Err(_) => LaunchSkillAvailability::Unchecked {
            code: "skill_check_failed",
            provider: Some(provider),
            message: "The skill availability check did not complete.".to_owned(),
        },
    }
}

async fn resolve_provider(
    database: &DatabaseConnection,
    request: &LaunchSkillAvailabilityRequest,
) -> Result<Provider, (&'static str, String)> {
    let chosen = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let slug = match (chosen(&request.agent), chosen(&request.profile)) {
        (Some(agent), _) => agent,
        // A profile is Codex-only, exactly as launch resolution treats it.
        (None, Some(_)) => Provider::Codex.slug().to_owned(),
        (None, None) => ticketry_settings::read_global_launch_default(database)
            .await
            .map_err(|_| {
                (
                    "provider_catalog_storage_failed",
                    "The global launch default could not be read.".to_owned(),
                )
            })?
            .map(|default| default.provider)
            .ok_or_else(|| {
                (
                    "agent_not_configured",
                    "No agent/provider is selected and no global launch default is configured."
                        .to_owned(),
                )
            })?,
    };
    Provider::from_slug(&slug).ok_or_else(|| {
        (
            "unknown_agent",
            format!("Agent/provider '{slug}' is not supported."),
        )
    })
}
