//! Authored settings persistence installed after the checked desktop handoff.
//!
//! App settings, local profiles, and installation feature flags share the
//! established data directory while Django effects retain read-only access.

mod adoption;
mod app_settings;
mod atomic_json;
pub(crate) mod entities;
mod error;
mod features;
mod graphql_types;
pub mod keybindings;
pub mod ownership_manifest;
mod profile_graphql;
mod profiles;
mod provider_catalog;
mod provider_catalog_read;
mod readiness;
pub mod schema;

pub use adoption::{
    adopt, preflight, AdoptionEvidence, JsonSourceClassification, SourceClassification,
};
pub use app_settings::{AppSetting, AppSettingRepository, SettingKey, SettingScope};
pub use error::SettingsPersistenceError;
pub use features::{FeatureFlags, FeatureStore};
pub use profile_graphql::SettingsStores;
pub use profiles::{ModuleLink, Profile, ProfileCatalog, ProfileStore};
pub use provider_catalog::{
    GlobalLaunchDefault, ProviderCatalog, ProviderCatalogError, ProviderCatalogService,
    ProviderCatalogUpdate,
};
pub use readiness::{
    publish as publish_readiness, published_readiness_is_complete, Slice2Readiness,
};

pub(crate) use profile_graphql::register as register_profile_graphql;
