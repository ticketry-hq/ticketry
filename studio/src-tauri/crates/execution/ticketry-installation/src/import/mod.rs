//! Import a supported PostgreSQL installation into canonical SQLite.
//!
//! PostgreSQL is opened through one repeatable-read, read-only transaction.
//! The importer copies that snapshot into a private SQLite installation,
//! compares canonical values across engines, and runs the ordinary SQLite
//! semantic preflight before returning it to adoption for ledger commit and
//! postflight. The source marker remains enabled throughout those steps. A
//! single rename of that marker is the activation boundary.

mod canonical;
pub(crate) mod cutover;
mod inventory;
mod schema_catalog;
mod source;
mod target;

mod seaography_override;

use std::fs;
use std::path::{Path, PathBuf};

use crate::{AdoptionFailure, AdoptionPlan, Phase, PostgresSource, Refusal};

/// A validated SQLite target that is not active yet.
pub struct StagedImport {
    directory: PathBuf,
    generation: String,
    bridges: Vec<String>,
}

impl StagedImport {
    #[must_use]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    #[must_use]
    pub fn generation(&self) -> &str {
        &self.generation
    }

    #[must_use]
    pub fn bridges(&self) -> &[String] {
        &self.bridges
    }

    pub fn into_parts(self) -> (PathBuf, String, Vec<String>) {
        (self.directory, self.generation, self.bridges)
    }
}

/// Build and validate a canonical target without changing the active engine.
pub async fn stage(
    data_directory: &Path,
    classified: &PostgresSource,
    plan: &AdoptionPlan,
) -> Result<StagedImport, AdoptionFailure> {
    let dsn = source::read_dsn(&classified.marker)?;
    let snapshot = source::Snapshot::open(&dsn).await?;
    let generation = snapshot.classify().await?;
    if plan.fault.as_ref() == Some(&Phase::Preflight) {
        return Err(failed(
            Phase::Preflight,
            Refusal::InjectedFault,
            "a deterministic fault fired while PostgreSQL was still the active source",
        ));
    }

    let directory = data_directory.join(format!(
        ".postgres-import.{}",
        uuid::Uuid::new_v4().simple()
    ));
    fs::create_dir(&directory).map_err(|error| {
        failed(
            Phase::BridgeWork,
            Refusal::SnapshotFailed,
            format!("the private import directory could not be created: {error}"),
        )
    })?;

    let outcome = target::copy_snapshot(&directory, &snapshot, &generation).await;
    let closed = snapshot.close().await;
    let (inventory, bridges) = match outcome {
        Ok(outcome) => outcome,
        // A failed target remains private and non-ready for diagnosis. Retry
        // always chooses a fresh directory, so no partial effect is replayed.
        Err(error) => return Err(error),
    };
    closed.map_err(|error| {
        failed(
            Phase::Preflight,
            Refusal::SemanticRefusal,
            format!("the read-only PostgreSQL snapshot did not close cleanly: {error}"),
        )
    })?;

    if plan.fault.as_ref() == Some(&Phase::BridgeWork) {
        return Err(failed(
            Phase::BridgeWork,
            Refusal::InjectedFault,
            format!(
                "a deterministic fault left a non-ready SQLite target with {} row(s)",
                inventory.total_rows()
            ),
        ));
    }

    Ok(StagedImport {
        directory,
        generation,
        bridges,
    })
}

pub(crate) fn failed(phase: Phase, refusal: Refusal, detail: impl Into<String>) -> AdoptionFailure {
    AdoptionFailure::new(phase, refusal, detail)
}
