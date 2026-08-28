//! Committing ownership, proving the result, and lifting the gate.
//!
//! One transaction records that Rust owns this installation. Everything after
//! it is validation: the adopted database is re-inventoried and compared with
//! the source it came from, rechecked structurally and semantically, and read
//! through the relationships the product actually uses. Readiness — the state
//! in which a mutation is accepted — is the last thing that happens, and it is
//! a separate call, because the capability handoffs run in between.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use sea_orm::{DatabaseConnection, TransactionTrait};

use super::error::{AdoptionFailure, Refusal};
use super::inventory::Inventory;
use super::ledger::{self, Completion, LedgerRow};
use super::outcome::{Adoption, AdoptionPath, EventBoundary, Readiness, EVIDENCE_FILE};
use super::phase::{AdoptionPlan, Phase};
use super::protection::Protection;
use super::{application_version, bridge, event_boundary, exclusive, fault, inventory};
use super::{postflight, semantic_bridge, RUST_LEAF};
use crate::installation::classification;

/// Commit ownership and validate the result. Readiness stays closed.
///
/// The exclusive window is opened and released on purpose. Postflight
/// reclassifies and rechecks the adopted installation through the same read
/// paths the product uses, and those open their own connections — which an
/// exclusive lock would refuse. Validating through the connection that just
/// wrote is asking the writer to grade its own work, so the lock is released
/// and the installation is examined as any reader would see it.
pub(super) async fn settle(
    data_directory: &Path,
    path: AdoptionPath,
    generation: String,
    protection: Option<Protection>,
    provided_bridges: &[String],
    semantic_bridges: &[String],
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    let database_path = data_directory.join("state.db");

    let (source, fingerprint, previously_ready, bridges) = {
        let database = exclusive::open_exclusive(&database_path).await?;
        let held = commit_ownership(
            &database,
            &generation,
            protection.as_ref(),
            provided_bridges,
            semantic_bridges,
            plan,
        )
        .await;
        let closed = database.close().await;
        let committed = held?;
        closed.map_err(|error| {
            AdoptionFailure::new(
                Phase::LedgerCommit,
                Refusal::LedgerFailed,
                format!("the installation stayed open after the ledger commit: {error}"),
            )
        })?;
        committed
    };

    let checked = {
        let reader = exclusive::open_shared(&database_path).await?;
        let outcome = postflight::check(data_directory, &reader, &source).await;
        let _ = reader.close().await;
        outcome?
    };
    fault(plan, Phase::Postflight)?;

    Ok(Adoption {
        path,
        generation,
        source_fingerprint: fingerprint,
        application_version: application_version(),
        rust_leaf: RUST_LEAF.to_owned(),
        bridges,
        snapshot: protection.map(|protection| protection.record),
        counts: checked.adopted.counts.clone(),
        preserved_digest: checked.adopted.combined_digest(),
        event_boundary: None,
        // The gate stays shut until the boundary is published. A record that
        // said otherwise here would be the one lie the whole sequence exists
        // to prevent.
        readiness: Readiness::Closed,
        previously_ready,
    })
}

/// Commit and postflight a staged PostgreSQL import before its activation.
pub(crate) async fn settle_import(
    data_directory: &Path,
    generation: String,
    bridges: &[String],
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    settle(
        data_directory,
        AdoptionPath::Imported,
        generation,
        None,
        bridges,
        &[],
        plan,
    )
    .await
}

/// Publish the boundary, mark the adoption complete, and open readiness.
///
/// Called after the capability handoffs, because the durable status-event
/// ledger the boundary is published into is provisioned by them. Idempotent:
/// an installation whose adoption already completed publishes nothing and
/// simply reports itself open.
///
/// # Errors
///
/// Returns an [`AdoptionFailure`] when the boundary cannot be published or the
/// ledger cannot record completion. Readiness stays closed on either.
pub async fn open_readiness(
    data_directory: &Path,
    adopted: Adoption,
) -> Result<Adoption, AdoptionFailure> {
    open_readiness_with(data_directory, adopted, &AdoptionPlan::default()).await
}

/// Open readiness with a deterministic fault injected after one named phase.
pub async fn open_readiness_with(
    data_directory: &Path,
    adopted: Adoption,
    plan: &AdoptionPlan,
) -> Result<Adoption, AdoptionFailure> {
    let database_path = data_directory.join("state.db");
    let database = exclusive::open_exclusive(&database_path).await?;
    let held = finish(&database, adopted.previously_ready, plan).await;
    let closed = database.close().await;
    let boundary = held?;
    closed.map_err(|error| {
        AdoptionFailure::new(
            Phase::Readiness,
            Refusal::PostflightFailed,
            format!("the adopted installation stayed open: {error}"),
        )
    })?;

    let ready = Adoption {
        event_boundary: boundary,
        readiness: Readiness::Open,
        ..adopted
    };
    super::snapshot_manifest::mark_retained_completed(data_directory)?;
    write_evidence(data_directory, &ready)?;
    Ok(ready)
}

/// Record that Rust owns this installation, in one transaction.
///
/// Returns what the rest of the sequence needs: the inventory the source held,
/// its fingerprint, this adoption's identity, and whether a previous run of the
/// whole sequence already finished — which is what makes a reopen a reopen.
pub(super) async fn commit_ownership(
    database: &DatabaseConnection,
    generation: &str,
    protection: Option<&Protection>,
    provided_bridges: &[String],
    semantic_bridges: &[String],
    plan: &AdoptionPlan,
) -> Result<(Inventory, String, bool, Vec<String>), AdoptionFailure> {
    let original = match protection {
        Some(protection) => protection.source.clone(),
        None => inventory::read(database).await.map_err(|error| {
            AdoptionFailure::new(
                Phase::LedgerCommit,
                Refusal::LedgerFailed,
                format!("the installation could not be inventoried: {error}"),
            )
        })?,
    };
    let fingerprint = match protection {
        Some(protection) => protection.fingerprint.clone(),
        None => fingerprint(database).await?,
    };

    let existing = ledger::read(database).await?;
    let previously_ready = matches!(
        existing.as_ref().map(|row| row.completion),
        Some(Completion::Ready)
    );
    let adoption_id = match &existing {
        Some(row) => row.adoption_id.clone(),
        None => uuid::Uuid::new_v4().simple().to_string(),
    };
    let mut bridge_ids = existing.as_ref().map_or_else(
        || {
            let selected = protection
                .and_then(|protection| protection.bridge)
                .map(|bridge| vec![bridge.id.clone()])
                .unwrap_or_default();
            if selected.is_empty() {
                provided_bridges.to_vec()
            } else {
                selected
            }
        },
        |row| row.bridges.clone(),
    );
    bridge_ids.extend_from_slice(semantic_bridges);
    bridge_ids.sort();
    bridge_ids.dedup();
    let mut expected = original;
    if !semantic_bridges.is_empty() {
        if existing.is_none() || protection.is_none() {
            return Err(AdoptionFailure::new(
                Phase::BridgeWork,
                Refusal::BridgePreconditionFailed,
                "a semantic repair requires a Rust-owned ledger and verified snapshot",
            ));
        }
        let transaction = database.begin().await.map_err(|error| {
            AdoptionFailure::new(Phase::BridgeWork, Refusal::LedgerFailed, error.to_string())
        })?;
        let repaired = async {
            let inventory = semantic_bridge::apply(&transaction, semantic_bridges).await?;
            fault(plan, Phase::BridgeWork)?;
            Ok::<Inventory, AdoptionFailure>(inventory)
        }
        .await;
        match repaired {
            Ok(inventory) => {
                expected = inventory;
                let row = ownership_row(
                    &adoption_id,
                    generation,
                    &fingerprint,
                    protection,
                    &expected,
                    bridge_ids.clone(),
                );
                if let Err(error) = ledger::replace(&transaction, &row).await {
                    let _ = transaction.rollback().await;
                    return Err(error);
                }
                transaction.commit().await.map_err(|error| {
                    AdoptionFailure::new(
                        Phase::LedgerCommit,
                        Refusal::LedgerFailed,
                        error.to_string(),
                    )
                })?;
            }
            Err(error) => {
                let _ = transaction.rollback().await;
                return Err(error);
            }
        }
    } else if existing.is_none() {
        if let Some(selected) = protection.and_then(|protection| protection.bridge) {
            bridge::set_foreign_keys(database, false).await?;
            let transaction = database.begin().await.map_err(|error| {
                AdoptionFailure::new(Phase::BridgeWork, Refusal::LedgerFailed, error.to_string())
            })?;
            let bridged = async {
                bridge::apply(&transaction, &[selected]).await?;
                fault(plan, Phase::BridgeWork)?;
                inventory::read(&transaction).await.map_err(|error| {
                    AdoptionFailure::new(
                        Phase::BridgeWork,
                        Refusal::BridgePostconditionFailed,
                        format!("{} could not inventory its result: {error}", selected.id),
                    )
                })
            }
            .await;
            match bridged {
                Ok(inventory) => {
                    expected = inventory;
                    let row = ownership_row(
                        &adoption_id,
                        generation,
                        &fingerprint,
                        protection,
                        &expected,
                        bridge_ids.clone(),
                    );
                    if let Err(error) = ledger::write(&transaction, &row).await {
                        let _ = transaction.rollback().await;
                        let _ = bridge::set_foreign_keys(database, true).await;
                        return Err(error);
                    }
                    let committed = transaction.commit().await.map_err(|error| {
                        AdoptionFailure::new(
                            Phase::LedgerCommit,
                            Refusal::LedgerFailed,
                            error.to_string(),
                        )
                    });
                    let restored = bridge::set_foreign_keys(database, true).await;
                    committed?;
                    restored?;
                }
                Err(error) => {
                    let _ = transaction.rollback().await;
                    let _ = bridge::set_foreign_keys(database, true).await;
                    return Err(error);
                }
            }
        } else {
            fault(plan, Phase::BridgeWork)?;
            ledger::commit(
                database,
                &ownership_row(
                    &adoption_id,
                    generation,
                    &fingerprint,
                    protection,
                    &expected,
                    bridge_ids.clone(),
                ),
            )
            .await?;
        }
    }
    fault(plan, Phase::LedgerCommit)?;
    Ok((expected, fingerprint, previously_ready, bridge_ids))
}

fn ownership_row(
    adoption_id: &str,
    generation: &str,
    fingerprint: &str,
    protection: Option<&Protection>,
    expected: &Inventory,
    bridges: Vec<String>,
) -> LedgerRow {
    LedgerRow {
        version: ledger::VERSION,
        adoption_id: adoption_id.to_owned(),
        source_generation: generation.to_owned(),
        source_fingerprint: fingerprint.to_owned(),
        application_version: application_version(),
        snapshot_file: protection.map(|protection| protection.record.file.clone()),
        snapshot_sha256: protection.map(|protection| protection.record.sha256.clone()),
        rust_leaf: RUST_LEAF.to_owned(),
        bridges,
        preserved_digest: expected.combined_digest(),
        counts: expected.counts.clone(),
        completion: Completion::Committed,
    }
}

/// Publish the boundary and mark the adoption complete.
pub(super) async fn finish(
    database: &DatabaseConnection,
    previously_ready: bool,
    plan: &AdoptionPlan,
) -> Result<Option<EventBoundary>, AdoptionFailure> {
    let row = ledger::read(database).await?.ok_or_else(|| {
        AdoptionFailure::new(
            Phase::EventBoundary,
            Refusal::EventBoundaryFailed,
            "readiness was asked for on an installation that records no adoption",
        )
    })?;
    // A reopen of an installation whose adoption already completed publishes
    // nothing: its boundary was published then, and every client that has ever
    // connected has converged past it.
    let boundary = if previously_ready {
        None
    } else {
        event_boundary::publish(database, &application_version(), &row.adoption_id).await?
    };
    fault(plan, Phase::EventBoundary)?;
    ledger::mark_ready(database).await?;
    fault(plan, Phase::Readiness)?;
    Ok(boundary)
}

pub(super) async fn fingerprint(database: &DatabaseConnection) -> Result<String, AdoptionFailure> {
    let observed = classification::schema_facts::read(database)
        .await
        .map_err(|error| {
            AdoptionFailure::new(
                Phase::LedgerCommit,
                Refusal::LedgerFailed,
                format!("the installation's schema could not be fingerprinted: {error}"),
            )
        })?;
    Ok(classification::schema_facts::fingerprint(
        &observed,
    ))
}

fn write_evidence(data_directory: &Path, adoption: &Adoption) -> Result<(), AdoptionFailure> {
    let staged = data_directory.join(format!(".{EVIDENCE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let encoded = serde_json::to_vec_pretty(adoption).map_err(|error| {
        AdoptionFailure::new(
            Phase::Readiness,
            Refusal::PostflightFailed,
            format!("could not encode the adoption evidence: {error}"),
        )
    })?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let write = options
        .open(&staged)
        .and_then(|mut file| file.write_all(&encoded).and_then(|()| file.sync_all()))
        .and_then(|()| fs::rename(&staged, Adoption::evidence_path(data_directory)));
    write.map_err(|error| {
        let _ = fs::remove_file(&staged);
        AdoptionFailure::new(
            Phase::Readiness,
            Refusal::PostflightFailed,
            format!("could not write the adoption evidence: {error}"),
        )
    })
}
