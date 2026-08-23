//! The verified recovery point, made before the installation is mutated.
//!
//! This is the phase that turns "we are about to rewrite the user's only
//! working installation" into a reversible act. It closes the installation to
//! other writers, folds the write-ahead log into the database file, copies the
//! result, hashes it, reopens the copy as its own database, and requires that
//! copy to reproduce the source row for row and value for value. Only a copy
//! that passes all of that is allowed to authorize a mutation.

use std::path::Path;

use super::bridge;
use super::error::{AdoptionFailure, Refusal};
use super::inventory::Inventory;
use super::ownership::fingerprint;
use super::phase::{AdoptionPlan, Phase};
use super::snapshot::SnapshotRecord;
use super::{application_version, now_rfc3339, RUST_LEAF};
use super::{checkpoint, exclusive, fault, inventory, snapshot, snapshot_manifest};

/// One verified recovery point, with its manifest, before any mutation.
pub(super) struct Protection {
    pub(super) record: SnapshotRecord,
    pub(super) source: Inventory,
    pub(super) fingerprint: String,
    pub(super) bridge: Option<&'static bridge::Bridge>,
}

pub(super) async fn protect(
    data_directory: &Path,
    generation: &str,
    plan: &AdoptionPlan,
) -> Result<Protection, AdoptionFailure> {
    let database_path = data_directory.join("state.db");
    let database = exclusive::open_exclusive(&database_path).await?;
    let held = async {
        fault(plan, Phase::WriterShutdown)?;
        checkpoint::checkpoint(&database).await?;
        fault(plan, Phase::WalCheckpoint)?;
        let source = inventory::read(&database).await.map_err(|error| {
            AdoptionFailure::new(
                Phase::WalCheckpoint,
                Refusal::CheckpointFailed,
                format!("the checkpointed installation could not be inventoried: {error}"),
            )
        })?;
        let fingerprint = fingerprint(&database).await?;
        Ok((source, fingerprint))
    }
    .await;
    // The snapshot is copied from a closed database. An open connection would
    // leave the copy describing a file SQLite still considers its own.
    let closed = database.close().await;
    let (source, fingerprint) = held?;
    closed.map_err(|error| {
        AdoptionFailure::new(
            Phase::SnapshotCopy,
            Refusal::SnapshotFailed,
            format!("the installation stayed open: {error}"),
        )
    })?;

    let created = snapshot::create(data_directory, &database_path)?;
    let pinned = snapshot::pin(data_directory, &created)?;
    fault(plan, Phase::SnapshotCopy)?;
    let record = snapshot::verify(&created, &source, false).await?;
    let pinned_record = snapshot::verify(&pinned, &source, true).await?;
    fault(plan, Phase::HashVerification)?;
    let selected_bridge = crate::installation_classification::manifest()
        .generation(generation)
        .filter(|recorded| recorded.expected == "bridge")
        .map(|_| bridge::select(generation, &fingerprint))
        .transpose()?;

    let manifest = snapshot_manifest::SnapshotManifest {
        manifest_version: snapshot_manifest::MANIFEST_VERSION,
        source_engine: "sqlite".to_owned(),
        source_generation: generation.to_owned(),
        source_fingerprint: fingerprint.clone(),
        source_application_version: generation.to_owned(),
        target_application_version: application_version(),
        rust_leaf: RUST_LEAF.to_owned(),
        created_at: now_rfc3339(),
        snapshot: record.clone(),
        bridges: selected_bridge
            .iter()
            .map(|bridge| bridge.id.clone())
            .collect(),
        counts: source.counts.clone(),
        external_roots: snapshot_manifest::external_roots(data_directory),
        completed: false,
    };
    manifest.write(data_directory)?;
    snapshot_manifest::SnapshotManifest {
        snapshot: pinned_record,
        ..manifest
    }
    .write(data_directory)?;

    Ok(Protection {
        record,
        source,
        fingerprint,
        bridge: selected_bridge,
    })
}
