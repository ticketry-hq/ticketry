//! Authored settings persistence installed after the checked desktop handoff.
//!
//! App settings and the provider catalog share the established data directory
//! while Django effects retain read-only access. The pre-Rust `profiles.json`
//! and `features.json` files are read-only history; see
//! [`legacy_profile_files`].

mod adoption;
mod app_setting;
mod app_settings;
mod atomic_json;
pub use ticketry_entities::settings as entities;
mod error;
mod global_launch_default;
pub mod instant_launch;
pub mod keybindings;
mod legacy_profile_files;
pub mod ownership_manifest;
mod provider_catalog;
pub mod provider_catalog_migrations;
mod provider_catalog_provisioning;
mod provider_catalog_read;
mod readiness;
pub mod schema;

pub use adoption::{
    adopt, preflight, AdoptionEvidence, JsonSourceClassification, SourceClassification,
};
pub use app_settings::{AppSetting, AppSettingRepository, SettingKey, SettingScope};
pub use atomic_json::write_json_atomically;
pub use error::SettingsPersistenceError;
pub use global_launch_default::{
    parse_global_launch_default, read_global_launch_default, GlobalLaunchDefault,
};
pub use legacy_profile_files::read_profile_file;
pub use legacy_profile_files::{ModuleLink, Profile, ProfileCatalog};
pub use provider_catalog::{
    ProviderCatalog, ProviderCatalogError, ProviderCatalogService, ProviderCatalogUpdate,
};
pub use provider_catalog_provisioning::provision as provision_provider_catalog;
pub use readiness::{
    publish as publish_readiness, published_readiness_is_complete, Slice2Readiness,
};
