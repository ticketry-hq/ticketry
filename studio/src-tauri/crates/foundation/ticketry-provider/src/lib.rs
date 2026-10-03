#![deny(private_bounds, private_interfaces)]

//! Provider-owned capabilities shared by settings and execution.

mod catalog;
mod contract;
mod error;
mod exec;
pub use exec::{construct_exec, ExecConstructionRequest};
mod launch;
mod profile;
mod providers;
mod trust;

pub use catalog::{CatalogRefreshPolicy, InstallationCatalog, ModelDefinition};
pub use contract::{provider_contract, Provider, ProviderContract, ProviderMetadata};
pub use error::{ProviderError, ProviderErrorCode};
pub use launch::{
    LaunchConstructionRequest, ProviderLaunch, ProviderLaunchKind, ProviderLaunchMetadata,
    ProviderOptions, RuntimeSettings, StartupScreen, TimeoutUnit,
};
pub use profile::ProfileSelection;
pub use trust::{
    DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, ProviderFailure,
};
