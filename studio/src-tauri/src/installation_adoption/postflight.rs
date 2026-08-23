//! Prove the adopted database is the source, before a mutation can reach it.
//!
//! Postflight is the last thing standing between a failed migration and a user
//! working on it. It runs after the ledger commits and before readiness opens,
//! because at that point the installation is Rust-owned but still lossless: the
//! verified snapshot restores it exactly, and no Rust write has happened.
//!
//! Four questions, in order of how cheaply they fail. Are the rows still there
//! and still the same values? Is the file still structurally sound? Do the
//! semantic rules that admitted this installation still hold? And can the
//! product actually read it? A yes to all four is what opens readiness.

use sea_orm::DatabaseConnection;

use super::error::{AdoptionFailure, Refusal};
use super::inventory::{self, Inventory};
use super::phase::Phase;
use super::representative_reads;

/// What postflight established, for the adoption evidence record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Postflight {
    /// The inventory of the adopted database.
    pub adopted: Inventory,
    /// Semantic rules rerun against the adopted database.
    pub invariants_checked: usize,
    /// Representative reads that answered.
    pub reads_proven: usize,
}

/// Compare, recheck, and prove. Any failure keeps readiness closed.
pub async fn check(
    data_directory: &std::path::Path,
    database: &DatabaseConnection,
    source: &Inventory,
) -> Result<Postflight, AdoptionFailure> {
    let adopted = inventory::read(database).await.map_err(|error| {
        refused(format!(
            "the adopted database could not be inventoried: {error}"
        ))
    })?;
    let differences = source.differences(&adopted);
    if !differences.is_empty() {
        return Err(refused(format!(
            "the adopted database does not reproduce the source: {}",
            differences.join("; ")
        )));
    }

    super::integrity::structural(database)
        .await
        .map_err(|error| refused(format!("the adopted database is not sound: {error}")))?;

    // The semantic rules run again from their own read-only view. Rerunning
    // them through this connection would ask the writer whether its own work
    // is valid; opening a second view asks the installation.
    let classified = crate::installation_classification::classify(data_directory)
        .await
        .map_err(|error| {
            refused(format!(
                "the adopted database no longer classifies: {error}"
            ))
        })?;
    let report = crate::installation_preflight::preflight(data_directory, &classified)
        .await
        .map_err(|error| {
            refused(format!(
                "the adopted database could not be rechecked: {error}"
            ))
        })?;
    if report.verdict() == crate::installation_preflight::Verdict::Refused {
        return Err(refused(format!(
            "the adopted database broke {} semantic rule(s): {}",
            report.defects.len(),
            report
                .defects
                .iter()
                .map(|defect| defect.code.clone())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }

    let present = inventory::product_tables(database)
        .await
        .map_err(|error| refused(format!("the adopted schema could not be listed: {error}")))?;
    let unanswered = representative_reads::prove(database, &present)
        .await
        .map_err(|error| refused(format!("a representative read could not run: {error}")))?;
    if !unanswered.is_empty() {
        return Err(refused(format!(
            "the adopted database is not readable: {}",
            unanswered.join("; ")
        )));
    }

    Ok(Postflight {
        adopted,
        invariants_checked: report.checked,
        reads_proven: representative_reads::reads().len() - unanswered.len(),
    })
}

fn refused(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(Phase::Postflight, Refusal::PostflightFailed, detail)
}
