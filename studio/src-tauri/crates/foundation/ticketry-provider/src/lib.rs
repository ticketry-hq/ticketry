#![deny(private_bounds, private_interfaces)]

//! Provider-owned capabilities shared by settings and execution.

mod catalog;
mod claude_state;
mod codex_global_mcp;
mod codex_mcp_profile;
mod contract;
mod error;
mod exec;
mod global_mcp;
pub use exec::{construct_exec, ExecConstructionRequest};
mod launch;
mod profile;
mod providers;
mod skill_availability;
mod trust;

pub use catalog::{CatalogRefreshPolicy, InstallationCatalog, ModelDefinition};
pub use codex_global_mcp::register_codex_global_mcp;
pub use codex_mcp_profile::prepare_codex_run_mcp_profile;
pub use contract::{provider_contract, Provider, ProviderContract, ProviderMetadata};
pub use error::{ProviderError, ProviderErrorCode};
pub use global_mcp::{
    register_claude_global_mcp, GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};
pub use launch::{
    LaunchConstructionRequest, ProviderLaunch, ProviderLaunchKind, ProviderLaunchMetadata,
    ProviderOptions, RuntimeSettings, StartupScreen, TimeoutUnit,
};
pub use profile::ProfileSelection;
pub use skill_availability::{
    check_skill_availability, SkillAvailability, SkillAvailabilityReport, SkillAvailabilityRequest,
    SkillAvailabilityStatus, SkillSearchEnvironment,
};
pub use trust::{
    DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, ProviderFailure,
};
