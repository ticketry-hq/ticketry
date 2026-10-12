//! Ordered data migrations for the provider catalog.

mod catalog_handler;
mod catalog_reconciliation;
mod catalog_registry;
mod catalog_runner;
mod catalog_surface;
pub use catalog_surface::{
    install_provider_catalog_migration, provider_catalog_migrations, ProviderCatalogMigration,
};
#[cfg(test)]
mod catalog_test_database;
mod catalog_validation;
mod codex_6_astra;
#[cfg(test)]
mod historical_compatibility_tests;
#[cfg(test)]
mod historical_installs_tests;
mod ledger;

pub const VERSION: i32 = 1;
