//! Read-only migration identities for startup chain consumers.

use std::sync::OnceLock;

use sea_orm::{DatabaseConnection, DbErr};

use super::{catalog_registry, catalog_runner};
use catalog_registry::CatalogEntry;

/// A registered catalog migration, with its content kept inside settings.
#[derive(Clone, Copy)]
pub struct ProviderCatalogMigration {
    entry: &'static CatalogEntry,
}

impl ProviderCatalogMigration {
    /// The historical migration identity.
    pub fn migration_id(&self) -> &'static str {
        self.entry.migration_id
    }

    /// The table recording this migration's provenance.
    pub fn ledger_table(&self) -> &'static str {
        self.entry.ledger
    }

    /// This migration's position among catalog and non-catalog chain steps.
    pub fn step(&self) -> u32 {
        self.entry.step
    }
}

/// Return every catalog migration in chain order, validating on first use.
pub fn provider_catalog_migrations() -> Result<&'static [ProviderCatalogMigration], DbErr> {
    let entries = catalog_registry::validated()?;
    static DESCRIPTORS: OnceLock<Vec<ProviderCatalogMigration>> = OnceLock::new();
    Ok(DESCRIPTORS.get_or_init(|| {
        entries
            .iter()
            .map(|entry| ProviderCatalogMigration { entry })
            .collect()
    }))
}

/// Atomically apply a registered migration, verifying any existing ledger.
pub async fn install_provider_catalog_migration(
    database: &DatabaseConnection,
    migration: &ProviderCatalogMigration,
) -> Result<(), DbErr> {
    catalog_registry::validated()?;
    catalog_runner::run(database, migration.entry).await
}
