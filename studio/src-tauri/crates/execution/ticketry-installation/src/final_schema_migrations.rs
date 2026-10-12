//! Compose numbered non-catalog steps with settings' catalog registry.
//!
//! New steps in either source take the next unused chain step number.

use std::sync::LazyLock;

use sea_orm::{DatabaseConnection, DbErr};
use ticketry_settings::{
    install_provider_catalog_migration, provider_catalog_migrations, ProviderCatalogMigration,
};

mod non_catalog;
use non_catalog::{NonCatalogMigration, NonCatalogStep, NON_CATALOG_STEPS};

/// Historical migration identities, in the same order as the startup chain.
/// The execution-schema step has no migration identity and is omitted.
pub static ORDERED_MIGRATION_IDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    chain()
        .expect("final-schema chain must have valid, unique step numbers")
        .iter()
        .filter_map(|step| step.migration_id)
        .collect()
});

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    // Validate the complete composition before any step writes to the database.
    for step in chain()? {
        step.install(database).await?;
    }
    Ok(())
}

struct ChainStep {
    step: u32,
    label: String,
    migration_id: Option<&'static str>,
    runner: Migration,
}

enum Migration {
    Catalog(ProviderCatalogMigration),
    NonCatalog(NonCatalogMigration),
}

impl ChainStep {
    async fn install(&self, database: &DatabaseConnection) -> Result<(), DbErr> {
        let result = match &self.runner {
            Migration::Catalog(migration) => {
                install_provider_catalog_migration(database, migration).await
            }
            Migration::NonCatalog(migration) => migration.install(database).await,
        };
        result.map_err(|error| step_error(&self.label, error))
    }
}

fn chain() -> Result<Vec<ChainStep>, DbErr> {
    merge_chain(NON_CATALOG_STEPS, provider_catalog_migrations()?)
}

fn merge_chain(
    non_catalog: &[NonCatalogStep],
    catalog: &[ProviderCatalogMigration],
) -> Result<Vec<ChainStep>, DbErr> {
    let mut steps: Vec<_> = non_catalog
        .iter()
        .map(|migration| ChainStep {
            step: migration.step,
            label: migration.label.to_owned(),
            migration_id: migration.migration_id,
            runner: Migration::NonCatalog(migration.runner),
        })
        .chain(catalog.iter().map(|migration| ChainStep {
            step: migration.step(),
            label: format!("{:04}", migration.step()),
            migration_id: Some(migration.migration_id()),
            runner: Migration::Catalog(*migration),
        }))
        .collect();
    steps.sort_unstable_by_key(|migration| migration.step);
    for pair in steps.windows(2) {
        if pair[0].step == pair[1].step {
            return Err(DbErr::Custom(format!(
                "duplicate final-schema chain step {}",
                pair[0].step
            )));
        }
    }
    Ok(steps)
}

fn step_error(step: &str, error: DbErr) -> DbErr {
    DbErr::Custom(format!("final-schema migration {step} failed: {error}"))
}

#[cfg(test)]
mod tests;
