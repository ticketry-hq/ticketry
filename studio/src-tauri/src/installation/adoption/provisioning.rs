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
use crate::installation::classification::{manifest, schema_facts};

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

/// The installation project a first launch provisions.
///
/// The slug is the one the rest of the app resolves the installation project
/// by, so startup, onboarding, and MCP discovery all name this row rather than
/// each creating or choosing a different one.
const INSTALLATION_PROJECT_SLUG: &str = "CDN";
const INSTALLATION_PROJECT_NAME: &str = "Coding";

/// The Workspace slug a first launch provisions, matching the shipped default.
///
/// The recorded schema is the Django leaf, where a project still requires a
/// workspace, so a first launch writes this row to satisfy that reference and
/// to carry the pending-onboarding flag. The project-onboarding migration moves
/// the flag onto the project and drops the table on the same startup.
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
    let project_id = seed_installation_project(database).await?;
    ticketry_settings::provision_provider_catalog(database)
        .await
        .map_err(|error| {
            failed(format!(
                "the provider catalog could not be created: {error}"
            ))
        })?;
    crate::installation::final_schema_migrations::install(database)
        .await
        .map_err(|error| {
            failed(format!(
                "the provisioned schema could not reach the Rust leaf: {error}"
            ))
        })?;
    crate::work_management::commands::default_project_catalog::seed(database, &project_id)
        .await
        .map_err(|error| {
            let detail = std::error::Error::source(&error)
                .map(ToString::to_string)
                .unwrap_or_else(|| error.to_string());
            failed(format!(
                "the installation catalog could not be created: {detail}"
            ))
        })?;
    Ok(())
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

/// Create the installation project a first launch needs to be usable.
///
/// Everything else a user sees — modules, issue types, states, workflows — is
/// created by the user or by onboarding. The installation project is the
/// exception, because it is the record the installation itself is identified
/// by: onboarding, the local settings profile, and MCP discovery all resolve
/// it, and none of them can resolve a project that does not exist yet.
///
/// The recorded schema is still the Django leaf, so the project is written
/// under a Workspace that carries the pending-onboarding flag. The
/// project-onboarding migration transfers that flag onto this project and drops
/// the Workspace table during the same startup, which leaves a first launch at
/// exactly the shape an adopted installation reaches.
async fn seed_installation_project(
    database: &DatabaseConnection,
) -> Result<String, AdoptionFailure> {
    let now = crate::installation::adoption::now_rfc3339();
    let workspace_id = uuid::Uuid::new_v4().simple().to_string();
    let project_id = uuid::Uuid::new_v4().simple().to_string();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO worktracker_workspace (id, slug, name, created_at, updated_at, onboarding_required) \
             VALUES (?, ?, ?, ?, ?, 1)",
            [
                workspace_id.clone().into(),
                WORKSPACE_SLUG.into(),
                WORKSPACE_SLUG.into(),
                now.clone().into(),
                now.clone().into(),
            ],
        ))
        .await
        .map_err(|error| failed(format!("the first workspace could not be created: {error}")))?;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO worktracker_project \
             (id, workspace_id, name, slug, description, seq_counter, state_revision, \
              manual_module_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, '', 0, 0, 0, ?, ?)",
            [
                project_id.clone().into(),
                workspace_id.into(),
                INSTALLATION_PROJECT_NAME.into(),
                INSTALLATION_PROJECT_SLUG.into(),
                now.clone().into(),
                now.into(),
            ],
        ))
        .await
        .map_err(|error| {
            failed(format!(
                "the installation project could not be created: {error}"
            ))
        })?;
    Ok(project_id)
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
    use sea_orm::{DatabaseConnection, EntityTrait};
    use ticketry_entities::work_management::{issue_type, state};

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

    #[tokio::test]
    async fn a_fresh_installation_project_has_its_reviewed_catalog() {
        let directory = tempfile::tempdir().expect("create a data directory");
        super::provision(directory.path())
            .await
            .expect("provision a fresh installation");
        let database: DatabaseConnection = super::open(&directory.path().join("state.db"))
            .await
            .expect("open the provisioned database");

        let states = state::Entity::find()
            .all(&database)
            .await
            .expect("read provisioned states");
        let issue_types = issue_type::Entity::find()
            .all(&database)
            .await
            .expect("read provisioned issue types");

        assert!(!states.is_empty());
        assert!(issue_types
            .iter()
            .any(|issue_type| issue_type.name == "Module" && issue_type.level == "module"));
        assert!(issue_types
            .iter()
            .any(|issue_type| issue_type.name == "Story" && issue_type.level == "task"));
        database.close().await.expect("close provisioned database");
    }
}
