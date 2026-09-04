#![deny(private_bounds, private_interfaces)]

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
mod error;
mod global_launch_default;
mod instant_launch;
mod keybindings;
mod legacy_profile_files;
mod ownership_manifest;
mod provider_catalog;
mod provider_catalog_migrations;
mod provider_catalog_provisioning;
mod provider_catalog_read;
mod readiness;
mod schema;

use ticketry_entities as entities;

pub use adoption::{
    adopt, preflight, AdoptionEvidence, JsonSourceClassification, SourceClassification,
};
pub use app_settings::{AppSetting, AppSettingRepository, SettingKey, SettingScope};
pub use atomic_json::write_json_atomically;
pub use error::SettingsPersistenceError;
pub use global_launch_default::{
    parse_global_launch_default, read_global_launch_default, GlobalLaunchDefault,
};
pub use instant_launch::{
    load as load_instant_launch_settings, read as read_instant_launch_setting,
    InstantLaunchSettings, MAX_INITIAL_PROMPT_CHARACTERS,
};
pub use keybindings::read as read_keybindings;
pub use legacy_profile_files::read_profile_file;
pub use legacy_profile_files::{ModuleLink, Profile, ProfileCatalog};
pub use ownership_manifest::VERSION as OWNERSHIP_MANIFEST_VERSION;
pub use ownership_manifest::{
    DJANGO_COMPATIBILITY_PORTS, LAUNCH_BINDING_ENTRY_SKILL_LEDGER, OWNED_ASSETS, OWNED_TABLES,
    PROVIDER_ADAPTER_SLUGS,
};
pub use provider_catalog::{
    ProviderCatalog, ProviderCatalogError, ProviderCatalogService, ProviderCatalogUpdate,
};
pub use provider_catalog_migrations::VERSION as PROVIDER_CATALOG_MIGRATIONS_VERSION;
pub use provider_catalog_migrations::{
    install_codex_5_6, install_codex_spark, CODEX_5_6_LEDGER, CODEX_5_6_MIGRATION_ID,
    CODEX_SPARK_LEDGER, CODEX_SPARK_MIGRATION_ID,
};
pub use provider_catalog_provisioning::provision as provision_provider_catalog;
pub use readiness::{
    publish as publish_readiness, published_readiness_is_complete, Slice2Readiness,
};
pub use schema::register as register_graphql;
