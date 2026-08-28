//! The verified recovery point, created before anything is mutated.
//!
//! This snapshot is the whole automatic-recovery story. Until readiness opens,
//! restoring it returns the user to the exact installation they started the app
//! with; after readiness it is a support artifact. That asymmetry is why it is
//! created, hashed, and *independently reopened* before the first write rather
//! than trusted because a copy call returned success.
//!
//! Independently means what it says: the snapshot is reopened as its own
//! database, checked for structural integrity, and re-inventoried. Its row
//! counts and preserved-value digests must equal the source's. A copy that
//! landed on a full disk, was truncated, or was written through a lying cache
//! fails there — which is the only place it can still fail harmlessly.
//!
//! Snapshots rotate. At least three generations are retained, and the final
//! Python-era cutover snapshot is pinned outside that rotation, because normal
//! upgrade churn must not be able to delete the last pre-Rust recovery point.

use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::error::{AdoptionFailure, Refusal};
use super::inventory::{self, Inventory};
use super::phase::Phase;

/// How many rotating snapshot generations are retained.
pub const RETAINED_GENERATIONS: usize = 3;

/// The name of the pinned final cutover snapshot.
///
/// It is not a rotation slot. Rotation never renames it, never overwrites it,
/// and never deletes it; removing it is an explicit user or support action.
pub const PINNED_SNAPSHOT: &str = "state.db.pre-rust-cutover.pinned";

/// The stem every rotating generation is named from.
const ROTATING_STEM: &str = "state.db.pre-rust-adoption";

/// One verified recovery point.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    /// The snapshot's file name inside the data directory.
    pub file: String,
    /// The rotating backup slot. The pinned cutover source uses generation 0.
    pub generation: u64,
    /// SHA-256 over the snapshot's bytes.
    pub sha256: String,
    /// Its size in bytes, so a truncated artifact is visible in evidence.
    pub bytes: u64,
    /// Whether this snapshot is pinned outside rotation.
    pub pinned: bool,
    /// Whether reopening it reproduced the source's counts and digests.
    pub verified: bool,
}

/// Copy the installation to a fresh rotating snapshot generation.
///
/// The copy is staged under a private temporary name and renamed into place, so
/// a crash mid-copy leaves the previous generations intact rather than a
/// half-written file wearing a recovery point's name.
pub fn create(data_directory: &Path, database_path: &Path) -> Result<PathBuf, AdoptionFailure> {
    let staged = data_directory.join(format!(".{ROTATING_STEM}.{}.tmp", uuid::Uuid::new_v4()));
    let outcome = copy_into(database_path, &staged).and_then(|()| rotate(data_directory, &staged));
    if outcome.is_err() {
        let _ = fs::remove_file(&staged);
    }
    outcome
}

/// Pin `snapshot` as the final Python-era cutover recovery point.
///
/// Pinning is idempotent and never replaces an existing pin: the first cutover
/// snapshot an installation ever produced is the one worth keeping, and a later
/// run has a Rust-owned source rather than the Python-era one. `None` means the
/// original pin already exists and must retain its original verification record.
pub fn pin(data_directory: &Path, snapshot: &Path) -> Result<Option<PathBuf>, AdoptionFailure> {
    let pinned = data_directory.join(PINNED_SNAPSHOT);
    if pinned.exists() {
        return Ok(None);
    }
    fs::copy(snapshot, &pinned).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not pin the snapshot: {error}"),
        )
    })?;
    Ok(Some(pinned))
}

/// Hash the snapshot and prove it reproduces the source, independently.
pub async fn verify(
    snapshot: &Path,
    source: &Inventory,
    pinned: bool,
) -> Result<SnapshotRecord, AdoptionFailure> {
    let sha256 = sha256(snapshot)?;
    let bytes = fs::metadata(snapshot)
        .map_err(|error| {
            failed(
                Phase::HashVerification,
                format!("could not measure the snapshot: {error}"),
            )
        })?
        .len();
    let reopened = super::exclusive::open_readable(snapshot)
        .await
        .map_err(|error| {
            failed(
                Phase::HashVerification,
                format!("the snapshot could not be reopened: {}", error.detail()),
            )
        })?;
    let checked = check_reopened(&reopened, source).await;
    let _ = reopened.close().await;
    // SQLite creates an empty log and shared-memory index beside any database
    // it opens in write-ahead-log mode, reader or not. A recovery point is a
    // file, not a live installation, so the reader's scratch files are removed
    // rather than left to suggest the snapshot has pending content.
    for suffix in ["-wal", "-shm"] {
        let scratch = PathBuf::from(format!("{}{suffix}", snapshot.display()));
        if scratch.metadata().is_ok_and(|meta| meta.len() == 0) || suffix == "-shm" {
            let _ = fs::remove_file(&scratch);
        }
    }
    checked?;
    Ok(SnapshotRecord {
        file: file_name(snapshot),
        generation: if pinned {
            0
        } else {
            rotating_generation(snapshot).unwrap_or(0)
        },
        sha256,
        bytes,
        pinned,
        verified: true,
    })
}

async fn check_reopened(
    snapshot: &sea_orm::DatabaseConnection,
    source: &Inventory,
) -> Result<(), AdoptionFailure> {
    super::integrity::structural(snapshot)
        .await
        .map_err(|error| {
            failed(
                Phase::HashVerification,
                format!("the reopened snapshot is not sound: {error}"),
            )
        })?;
    let copied = inventory::read(snapshot).await.map_err(|error| {
        failed(
            Phase::HashVerification,
            format!("the reopened snapshot could not be inventoried: {error}"),
        )
    })?;
    let differences = source.differences(&copied);
    if !differences.is_empty() {
        return Err(failed(
            Phase::HashVerification,
            format!(
                "the recovery snapshot does not reproduce the source: {}",
                differences.join("; ")
            ),
        ));
    }
    Ok(())
}

/// Every retained recovery point, newest generation first, pinned last.
///
/// Recovery discovery reads this. It reports file names, sizes, and hashes —
/// never the content of the installation they hold.
pub fn retained(data_directory: &Path) -> Vec<PathBuf> {
    let mut found = (1..=RETAINED_GENERATIONS)
        .map(|generation| generation_path(data_directory, generation))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    let pinned = data_directory.join(PINNED_SNAPSHOT);
    if pinned.is_file() {
        found.push(pinned);
    }
    found
}

fn rotate(data_directory: &Path, staged: &Path) -> Result<PathBuf, AdoptionFailure> {
    let oldest = generation_path(data_directory, RETAINED_GENERATIONS);
    if oldest.exists() {
        fs::remove_file(&oldest).map_err(|error| {
            failed(
                Phase::SnapshotCopy,
                format!("could not retire the oldest snapshot: {error}"),
            )
        })?;
        remove_manifest(&oldest)?;
    }
    for generation in (1..RETAINED_GENERATIONS).rev() {
        let from = generation_path(data_directory, generation);
        if from.exists() {
            let to = generation_path(data_directory, generation + 1);
            fs::rename(&from, &to).map_err(|error| {
                failed(
                    Phase::SnapshotCopy,
                    format!("could not rotate snapshot generation {generation}: {error}"),
                )
            })?;
            rotate_manifest(&from, &to)?;
        }
    }
    let newest = generation_path(data_directory, 1);
    fs::rename(staged, &newest).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not place the new snapshot: {error}"),
        )
    })?;
    sync_directory(data_directory)?;
    Ok(newest)
}

fn manifest_path(snapshot: &Path) -> PathBuf {
    snapshot.with_file_name(format!("{}.manifest.json", file_name(snapshot)))
}

fn remove_manifest(snapshot: &Path) -> Result<(), AdoptionFailure> {
    let manifest = manifest_path(snapshot);
    if manifest.exists() {
        fs::remove_file(&manifest).map_err(|error| {
            failed(
                Phase::SnapshotCopy,
                format!("could not retire the oldest snapshot manifest: {error}"),
            )
        })?;
    }
    Ok(())
}

fn rotate_manifest(from: &Path, to: &Path) -> Result<(), AdoptionFailure> {
    let source = manifest_path(from);
    if !source.exists() {
        return Ok(());
    }
    let mut manifest = super::snapshot_manifest::SnapshotManifest::read(&source)?;
    manifest.snapshot.file = file_name(to);
    manifest.snapshot.generation = rotating_generation(to).unwrap_or(0);
    fs::remove_file(&source).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not retire a rotated snapshot manifest: {error}"),
        )
    })?;
    manifest.write(to.parent().unwrap_or_else(|| Path::new(".")))
}

fn copy_into(source: &Path, staged: &Path) -> Result<(), AdoptionFailure> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut destination = options.open(staged).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not create the snapshot file: {error}"),
        )
    })?;
    let mut reader = File::open(source).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not read the installation: {error}"),
        )
    })?;
    std::io::copy(&mut reader, &mut destination).map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not copy the installation: {error}"),
        )
    })?;
    // Without this the copy exists only in the page cache, and a snapshot that
    // does not survive the crash it protects against protects against nothing.
    destination.sync_all().map_err(|error| {
        failed(
            Phase::SnapshotCopy,
            format!("could not flush the snapshot to disk: {error}"),
        )
    })
}

fn sync_directory(data_directory: &Path) -> Result<(), AdoptionFailure> {
    File::open(data_directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            failed(
                Phase::SnapshotCopy,
                format!("could not flush the data directory: {error}"),
            )
        })
}

fn generation_path(data_directory: &Path, generation: usize) -> PathBuf {
    data_directory.join(format!("{ROTATING_STEM}.{generation}"))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn sha256(path: &Path) -> Result<String, AdoptionFailure> {
    let mut file = File::open(path).map_err(|error| {
        failed(
            Phase::HashVerification,
            format!("could not open the snapshot to hash it: {error}"),
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            failed(
                Phase::HashVerification,
                format!("could not read the snapshot to hash it: {error}"),
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn rotating_generation(path: &Path) -> Option<u64> {
    file_name(path)
        .strip_prefix(&format!("{ROTATING_STEM}."))
        .and_then(|value| value.parse().ok())
}

fn failed(phase: Phase, detail: impl Into<String>) -> AdoptionFailure {
    AdoptionFailure::new(phase, Refusal::SnapshotFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{retained, PINNED_SNAPSHOT, RETAINED_GENERATIONS};

    #[test]
    fn at_least_three_generations_are_retained() {
        const { assert!(RETAINED_GENERATIONS >= 3) };
    }

    #[test]
    fn the_pinned_snapshot_is_not_a_rotation_slot() {
        for generation in 1..=RETAINED_GENERATIONS {
            assert_ne!(
                PINNED_SNAPSHOT,
                format!("{}.{generation}", super::ROTATING_STEM),
                "rotation would overwrite the pinned cutover snapshot"
            );
        }
    }

    #[test]
    fn an_installation_with_no_snapshot_lists_none() {
        let directory = tempfile::tempdir().expect("create a data directory");
        assert!(retained(directory.path()).is_empty());
    }
}
