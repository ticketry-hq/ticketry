//! A first launch, created directly at the current Rust leaf.
//!
//! An empty data directory has nothing to preserve, so it needs none of the
//! adoption sequence: no snapshot protects rows that do not exist, and no
//! bridge carries a history that never happened. What it does need is to arrive
//! at exactly the schema an adopted installation arrives at. Two shapes of
//! "current" — one migrated, one provisioned — would mean every later migration
//! had two starting points to be correct against.
//!
//! So provisioning replays a recorded schema and then proves it. The recorded
//! statements are read back out of a database Django's own migration executor
//! built, by the same generator that produces the classification manifest, and
//! the provisioned result must reproduce that manifest's current fingerprint.
//! A drifted artifact refuses a first launch rather than shaping it wrongly.
//!
//! The new installation is staged and renamed into place. A first launch that
//! is interrupted halfway leaves an empty data directory, which is the state it
//! started in, rather than a partial database the next launch would have to
//! classify.

use std::fs;
use std::path::Path;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;
use crate::installation_classification::{manifest, schema_facts};

/// The recorded schema a first launch is provisioned into.
const RECORDED_SCHEMA: &str = include_str!("provisioning.v1.sql");

/// The migration-ledger provenance a provisioned installation keeps.
///
/// A first launch has no Python history and runs no bridge. It records this
/// ledger anyway, for one reason that is true only while the sidecar still
/// ships: Django and the six capability handoffs identify a source by exactly
/// these rows, and a Django process that believed the schema were unmigrated
/// would try to create tables that already exist. Retiring the sidecar deletes
/// this artifact and the one call below with it.
const RECORDED_LEDGER: &str = include_str!("provisioning-ledger.v1.sql");

/// The workspace slug a first launch provisions, matching the shipped default.
const WORKSPACE_SLUG: &str = "meml";

/// Create the installation at the current leaf, or leave the directory empty.
pub async fn provision(data_directory: &Path) -> Result<(), AdoptionFailure> {
    let staged = data_directory.join(format!(".state.db.provisioning.{}", uuid::Uuid::new_v4()));
    let outcome = build(&staged).await;
    match outcome {
        Ok(()) => fs::rename(&staged, data_directory.join("state.db")).map_err(|error| {
            failed(format!(
                "the provisioned installation could not be placed: {error}"
            ))
        }),
        Err(error) => {
            for suffix in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{suffix}", staged.display()));
            }
            Err(error)
        }
    }
}

async fn build(staged: &Path) -> Result<(), AdoptionFailure> {
    let database = open(staged).await?;
    let outcome = install(&database).await;
    let closed = database.close().await;
    outcome?;
    closed.map_err(|error| failed(format!("the provisioned installation stayed open: {error}")))
}

async fn install(database: &DatabaseConnection) -> Result<(), AdoptionFailure> {
    database
        .execute_unprepared(RECORDED_SCHEMA)
        .await
        .map_err(|error| failed(format!("the recorded schema could not be applied: {error}")))?;
    verify(database).await?;
    database
        .execute_unprepared(RECORDED_LEDGER)
        .await
        .map_err(|error| {
            failed(format!(
                "the recorded migration provenance could not be applied: {error}"
            ))
        })?;
    seed_workspace(database).await?;
    crate::settings_persistence::provision_provider_catalog(database)
        .await
        .map_err(|error| {
            failed(format!(
                "the provider catalog could not be created: {error}"
            ))
        })
}

/// Refuse a provisioned database that is not the recorded current generation.
///
/// The check is the same fingerprint classification computes, so a first launch
/// and an adopted installation are proven identical by one definition rather
/// than by two that happen to agree today.
async fn verify(database: &DatabaseConnection) -> Result<(), AdoptionFailure> {
    let observed = schema_facts::read(database).await.map_err(|error| {
        failed(format!(
            "the provisioned schema could not be read back: {error}"
        ))
    })?;
    let fingerprint = schema_facts::fingerprint(&observed);
    let expected = &manifest().current().fingerprint;
    if &fingerprint != expected {
        return Err(failed(format!(
            "provisioning produced a schema this release does not recognize as {}",
            manifest().current_generation
        )));
    }
    Ok(())
}

/// Create the workspace row a first launch needs to be usable.
///
/// Everything else a user sees — projects, issue types, states, workflows — is
/// created by the user or by onboarding. The workspace is the exception because
/// nothing can be created without one.
async fn seed_workspace(database: &DatabaseConnection) -> Result<(), AdoptionFailure> {
    let now = crate::installation_adoption::now_rfc3339();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO worktracker_workspace (id, slug, name, created_at, updated_at, onboarding_required) \
             VALUES (?, ?, ?, ?, ?, 1)",
            [
                uuid::Uuid::new_v4().simple().to_string().into(),
                WORKSPACE_SLUG.into(),
                WORKSPACE_SLUG.into(),
                now.clone().into(),
                now.into(),
            ],
        ))
        .await
        .map_err(|error| failed(format!("the first workspace could not be created: {error}")))?;
    Ok(())
}

async fn open(staged: &Path) -> Result<DatabaseConnection, AdoptionFailure> {
    let owned = staged.to_owned();
    let mut options = ConnectOptions::new("sqlite://provisioning?mode=rwc");
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |sqlite| {
            sqlite
                .filename(owned.clone())
                .create_if_missing(true)
                .pragma("foreign_keys", "ON")
        });
    Database::connect(options)
        .await
        .map_err(|error| failed(format!("a new installation could not be created: {error}")))
}

fn failed(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(Phase::Provisioning, Refusal::ProvisioningFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{manifest, RECORDED_SCHEMA};

    #[test]
    fn the_recorded_schema_names_the_generation_it_reproduces() {
        let header = RECORDED_SCHEMA
            .lines()
            .take_while(|line| line.starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            header.contains(&format!("generation: {}", manifest().current_generation)),
            "the provisioning artifact was generated from another generation"
        );
        assert!(
            header.contains(&manifest().current().fingerprint),
            "the provisioning artifact and the classification manifest disagree"
        );
    }

    #[test]
    fn the_recorded_schema_is_generated_not_authored() {
        assert!(RECORDED_SCHEMA.starts_with("-- Generated by scripts/installation_corpus.py."));
    }

    #[test]
    fn the_schema_artifact_holds_no_rows() {
        // Schema and provenance are separate artifacts so that retiring the
        // sidecar removes the provenance without touching the schema.
        assert!(!RECORDED_SCHEMA.to_uppercase().contains("INSERT INTO"));
    }

    #[test]
    fn the_provenance_artifact_writes_only_the_migration_ledger() {
        for statement in super::RECORDED_LEDGER
            .lines()
            .filter(|line| !line.starts_with("--") && !line.trim().is_empty())
        {
            assert!(
                statement.starts_with("INSERT INTO django_migrations "),
                "provisioning provenance would write outside the migration ledger: {statement}"
            );
        }
    }

    #[test]
    fn the_provenance_records_the_generation_the_schema_reproduces() {
        assert!(super::RECORDED_LEDGER
            .contains(&format!("generation: {}", manifest().current_generation)));
    }
}
