//! Deterministic discovery and independent validation of recovery points.

use std::path::{Path, PathBuf};

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;
use super::snapshot_manifest::SnapshotManifest;

/// List retained recovery manifests in snapshot rotation order.
///
/// The returned data contains fixed root names and aggregate counts, never
/// database rows, credentials, prompts, command lines, or absolute paths.
pub fn discover(data_directory: &Path) -> Result<Vec<SnapshotManifest>, AdoptionFailure> {
    super::snapshot::retained(data_directory)
        .into_iter()
        .map(|snapshot| SnapshotManifest::read(&manifest_path(&snapshot)))
        .collect()
}

/// Reopen and validate one discovered recovery point before a restore may use it.
pub async fn validate_selected(
    data_directory: &Path,
    file: &str,
) -> Result<SnapshotManifest, AdoptionFailure> {
    if Path::new(file).file_name().and_then(|name| name.to_str()) != Some(file) {
        return Err(failed(
            "the recovery selection must be a retained file name",
        ));
    }
    let snapshot = super::snapshot::retained(data_directory)
        .into_iter()
        .find(|path| path.file_name().and_then(|name| name.to_str()) == Some(file))
        .ok_or_else(|| failed("the recovery selection is not retained"))?;
    let manifest = SnapshotManifest::read(&manifest_path(&snapshot))?;
    if manifest.snapshot.file != file || !manifest.snapshot.verified {
        return Err(failed(
            "the recovery manifest does not authorize this snapshot",
        ));
    }
    let metadata = std::fs::metadata(&snapshot)
        .map_err(|error| failed(format!("could not measure the recovery snapshot: {error}")))?;
    if metadata.len() != manifest.snapshot.bytes {
        return Err(failed(
            "the recovery snapshot size does not match its manifest",
        ));
    }
    if super::snapshot::sha256(&snapshot)? != manifest.snapshot.sha256 {
        return Err(failed(
            "the recovery snapshot hash does not match its manifest",
        ));
    }
    let database = super::exclusive::open_readable(&snapshot).await?;
    let checked = async {
        super::integrity::structural(&database)
            .await
            .map_err(|error| failed(format!("the recovery snapshot is not sound: {error}")))?;
        let inventory = super::inventory::read(&database).await.map_err(|error| {
            failed(format!(
                "could not inventory the recovery snapshot: {error}"
            ))
        })?;
        if inventory.counts != manifest.counts {
            return Err(failed(
                "the recovery snapshot counts do not match its manifest",
            ));
        }
        Ok(())
    }
    .await;
    let _ = database.close().await;
    checked?;
    Ok(manifest)
}

fn manifest_path(snapshot: &Path) -> PathBuf {
    snapshot.with_file_name(format!(
        "{}.manifest.json",
        snapshot
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default()
    ))
}

fn failed(detail: impl Into<String>) -> AdoptionFailure {
    AdoptionFailure::new(Phase::HashVerification, Refusal::SnapshotFailed, detail)
}
