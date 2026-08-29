//! Take exclusive ownership of one installation, losslessly, exactly once.
//!
//! Classification says which installation this is. Preflight says whether what
//! it contains can be carried forward. This module is what happens next, and it
//! is the step the whole migration is nervous about: it opens the user's only
//! working installation for writing.
//!
//! Everything here exists to keep that step reversible for as long as possible.
//! Nothing is written until the installation is provably ours alone, its
//! write-ahead log is folded into the database file, and a hashed copy has been
//! made *and independently reopened and re-inventoried*. Only then does one
//! transaction record that Rust owns it. Only after that record is validated
//! against the source it came from does readiness open, and only after
//! readiness does any mutation reach the installation. Before that line the
//! automatic recovery path is a verified snapshot; after it, recovery is a
//! manual support operation, which is why the line is drawn where it is and not
//! one phase earlier.
//!
//! Readiness is opened in a second, separate call. Between the two, the
//! capability handoffs provision the Rust-only journals this installation did
//! not have — including the durable status-event ledger the boundary is
//! published into. Publishing a boundary into a ledger that does not exist yet
//! is not possible, and inventing one here would put the Runs capability's
//! schema in two places. So [`adopt`] takes ownership and proves the result,
//! and [`open_readiness`] publishes the boundary and lifts the gate.
//!
//! Historical SQLite generations and the current SQLite generation are adopted in
//! place, because an export and re-import would regenerate the identities the
//! whole product refers to. An empty data directory is provisioned directly at
//! the Rust leaf, without Python. An installation Rust already owns is reopened
//! idempotently: reopening replays nothing, publishes no new history, and
//! starts no automation, launch, cleanup, Git, or filesystem effect. A
//! PostgreSQL follows the separate staged-import path.

pub mod bridge;
pub mod checkpoint;
pub mod error;
pub mod event_boundary;
pub mod exclusive;
pub mod integrity;
pub mod inventory;
pub mod ledger;
pub mod outcome;
pub mod ownership;
pub mod phase;
pub mod postflight;
pub mod protection;
pub mod provisioning;
pub mod recovery;
pub mod representative_reads;
pub mod seaography_override;
pub mod semantic_bridge;
pub mod snapshot;
pub mod snapshot_manifest;

use std::path::Path;

pub use error::{AdoptionFailure, Refusal};
pub use ledger::{Completion, LedgerRow, LEDGER_TABLE, RUST_LEAF};
pub use outcome::{Adoption, AdoptionPath, EventBoundary, Readiness, EVIDENCE_FILE};
pub use ownership::{open_readiness, open_readiness_with};
pub use phase::{AdoptionPlan, Phase};
pub use snapshot::SnapshotRecord;

use crate::installation::classification::{self, Installation};
use crate::installation::preflight::{self, Verdict};
use ownership::settle;
use protection::protect;

/// The Ticketry release performing the adoption.
fn application_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// The current instant, in the form evidence records use.
pub(crate) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Bring `data_directory` to Rust readiness, or refuse with the reason.
///
/// # Errors
///
/// Every [`AdoptionFailure`] leaves readiness closed. A failure before the
/// exclusive phase leaves the source byte-for-byte reusable; a failure after it
/// leaves the verified snapshot as the recovery path.
pub async fn adopt(data_directory: &Path) -> Result<Adoption, AdoptionFailure> {
    adopt_with(data_directory, &AdoptionPlan::default()).await
}

/// Adopt with a deterministic fault injected after one named phase.
pub async fn adopt_with(
    data_directory: &Path,
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    exclusive::hold_lease(data_directory)?;
    fault(plan, Phase::LeaseAcquisition)?;

    let classified = classification::classify(data_directory)
        .await
        .map_err(|error| {
            AdoptionFailure::new(
                Phase::Classification,
                Refusal::UnsupportedSource,
                error.to_string(),
            )
        })?;
    fault(plan, Phase::Classification)?;

    match &classified {
        Installation::SqliteHistorical(_) => existing(data_directory, &classified, plan).await,
        Installation::PostgresImportSource(source) => {
            let staged = crate::installation::import::stage(data_directory, source, plan).await?;
            let adopted = ownership::settle_import(
                staged.directory(),
                staged.generation().to_owned(),
                staged.bridges(),
                plan,
            )
            .await;
            match adopted {
                Ok(adopted) => {
                    crate::installation::import::activate(data_directory, staged).map(|()| adopted)
                }
                // Keep a failed postflight target as non-ready evidence. The
                // PostgreSQL marker still selects the untouched source, and a
                // retry builds a fresh staged target without reusing effects.
                Err(error) => Err(error),
            }
        }
        Installation::Empty => first_launch(data_directory, plan).await,
        Installation::SqliteCurrent(_) | Installation::RustOwned(_) => {
            existing(data_directory, &classified, plan).await
        }
    }
}

/// Create and validate a first-launch installation at the Rust leaf.
async fn first_launch(
    data_directory: &Path,
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    provisioning::provision(data_directory).await?;
    fault(plan, Phase::Provisioning)?;
    let provisioned = classification::classify(data_directory)
        .await
        .map_err(|error| {
            AdoptionFailure::new(
                Phase::Provisioning,
                Refusal::ProvisioningFailed,
                format!("the provisioned installation does not classify: {error}"),
            )
        })?;
    settle(
        data_directory,
        AdoptionPath::Provisioned,
        provisioned.generation().to_owned(),
        None,
        &[],
        &[],
        plan,
    )
    .await
}

/// Adopt a current installation, or reopen one Rust already owns.
async fn existing(
    data_directory: &Path,
    classified: &Installation,
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    let report = preflight::preflight(data_directory, classified)
        .await
        .map_err(|error| {
            AdoptionFailure::new(
                Phase::Preflight,
                Refusal::SemanticRefusal,
                error.to_string(),
            )
        })?;
    if report.verdict() == Verdict::Refused {
        return Err(AdoptionFailure::new(
            Phase::Preflight,
            Refusal::SemanticRefusal,
            format!(
                "{} defect(s) with no named bridge: {}",
                report.defects.len(),
                report
                    .defects
                    .iter()
                    .filter(|defect| !defect.is_admitted())
                    .map(|defect| format!("{} ({} row(s))", defect.code, defect.count))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ));
    }
    fault(plan, Phase::Preflight)?;
    let semantic_bridges = report.required_bridges();

    let already_owned = matches!(classified, Installation::RustOwned(_));
    let path = if already_owned {
        AdoptionPath::Reopened
    } else if matches!(classified, Installation::SqliteHistorical(_)) {
        AdoptionPath::Bridged
    } else {
        AdoptionPath::Adopted
    };
    let generation = classified.generation().to_owned();
    let snapshot = if already_owned && semantic_bridges.is_empty() {
        // Reopening protects nothing new: the installation is already Rust
        // owned, and its pre-Rust recovery point was pinned when it was
        // adopted. Copying it again would rotate that history out.
        None
    } else {
        Some(protect(data_directory, &generation, &semantic_bridges, plan).await?)
    };
    settle(
        data_directory,
        path,
        generation,
        snapshot,
        &[],
        &semantic_bridges,
        plan,
    )
    .await
}

fn fault(plan: &AdoptionPlan, phase: Phase) -> Result<(), AdoptionFailure> {
    if plan.faults_after(phase) {
        return Err(AdoptionFailure::new(
            phase,
            Refusal::InjectedFault,
            format!("a deterministic fault point fired after {}", phase.label()),
        ));
    }
    Ok(())
}
