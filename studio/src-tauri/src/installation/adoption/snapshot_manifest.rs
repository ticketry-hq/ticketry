//! What a recovery point says about itself, without opening it.
//!
//! Support has to identify the right snapshot before restoring one, and the
//! only safe way to do that is from metadata written beside it. Opening a
//! user's database to find out which release wrote it is both slow and exactly
//! the kind of access a support conversation should not require.
//!
//! The manifest therefore carries versions, times, hashes, counts, and the
//! roots the installation depends on — and nothing that could identify the work
//! stored inside it. External authorities (attachments, worktrees, hook spool,
//! tmux) are *named*, never copied: a worktree is a Git checkout somewhere on
//! the user's disk, and duplicating it into a startup snapshot would make
//! adoption unbounded while still not capturing the repository it belongs to.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;
use super::snapshot::SnapshotRecord;

/// The manifest format version, so a future reader can refuse an older shape.
pub const MANIFEST_VERSION: u32 = 1;

/// An external authority the installation refers to but the snapshot omits.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRoot {
    /// What the root holds: `media`, `worktrees`, `hook-spool`, `log`.
    pub kind: String,
    /// Its name inside the data directory. Never an absolute user path.
    pub name: String,
    /// Whether it existed when the snapshot was taken.
    pub present: bool,
}

/// Everything recorded about one recovery point.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    /// The manifest format version.
    pub manifest_version: u32,
    /// The engine the source was stored in.
    pub source_engine: String,
    /// The classified generation the snapshot holds.
    pub source_generation: String,
    /// The checked product-schema fingerprint of that generation.
    pub source_fingerprint: String,
    /// The Ticketry version the snapshot was taken from.
    pub source_application_version: String,
    /// The Ticketry version performing the adoption.
    pub target_application_version: String,
    /// The Rust migration leaf the adoption targets.
    pub rust_leaf: String,
    /// When the snapshot was created, as an RFC 3339 instant.
    pub created_at: String,
    /// The snapshot file, hash, size, and verification result.
    pub snapshot: SnapshotRecord,
    /// Named historical bridges applied. Empty in this release.
    pub bridges: Vec<String>,
    /// Rows per product table at the moment of the snapshot.
    pub counts: BTreeMap<String, u64>,
    /// External authorities the snapshot names rather than copies.
    pub external_roots: Vec<ExternalRoot>,
    /// Whether the adoption this snapshot protects completed.
    pub completed: bool,
}

impl SnapshotManifest {
    /// The manifest file that accompanies `snapshot`.
    #[must_use]
    pub fn path(data_directory: &Path, snapshot: &SnapshotRecord) -> std::path::PathBuf {
        data_directory.join(format!("{}.manifest.json", snapshot.file))
    }

    /// Write the manifest atomically beside its snapshot.
    pub fn write(&self, data_directory: &Path) -> Result<(), AdoptionFailure> {
        let path = Self::path(data_directory, &self.snapshot);
        let staged = data_directory.join(format!(
            ".{}.manifest.{}.tmp",
            self.snapshot.file,
            uuid::Uuid::new_v4()
        ));
        let encoded = serde_json::to_vec_pretty(self)
            .map_err(|error| failed(format!("could not encode the snapshot manifest: {error}")))?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&staged)
            .map_err(|error| failed(format!("could not create the snapshot manifest: {error}")))?;
        file.write_all(&encoded)
            .and_then(|()| file.sync_all())
            .map_err(|error| failed(format!("could not write the snapshot manifest: {error}")))?;
        fs::rename(&staged, &path)
            .map_err(|error| failed(format!("could not place the snapshot manifest: {error}")))
    }

    pub(crate) fn read(path: &Path) -> Result<Self, AdoptionFailure> {
        let bytes = fs::read(path)
            .map_err(|error| failed(format!("could not read the snapshot manifest: {error}")))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| failed(format!("could not decode the snapshot manifest: {error}")))
    }

    pub(crate) fn completed(mut self, completed: bool) -> Self {
        self.completed = completed;
        self
    }
}

/// The external authorities every installation refers to.
///
/// They are listed by fixed name rather than discovered, so a manifest cannot
/// grow an entry naming something inside the user's work.
pub fn external_roots(data_directory: &Path) -> Vec<ExternalRoot> {
    let local = |kind: &str, name: &str| ExternalRoot {
        kind: kind.to_owned(),
        name: name.to_owned(),
        present: data_directory.join(name).exists(),
    };
    vec![
        local("attachments", "media"),
        ExternalRoot {
            kind: "documents".to_owned(),
            name: "authorized-document-roots".to_owned(),
            present: true,
        },
        ExternalRoot {
            kind: "worktrees".to_owned(),
            name: "authorized-worktree-roots".to_owned(),
            present: true,
        },
        ExternalRoot {
            kind: "hook-spool".to_owned(),
            name: "ticketry-hook-spool".to_owned(),
            present: crate::terminal::lifecycle::hook_spool_directory(data_directory).exists(),
        },
        local("profiles", "profiles.json"),
        local("features", "features.json"),
        local("logs", "logs"),
        ExternalRoot {
            kind: "tmux".to_owned(),
            name: "tmux-server".to_owned(),
            present: true,
        },
    ]
}

/// Mark every retained recovery point after the durable readiness commit.
/// Repeating this on restart repairs a crash between those two file writes.
pub(crate) fn mark_retained_completed(data_directory: &Path) -> Result<(), AdoptionFailure> {
    for snapshot in super::snapshot::retained(data_directory) {
        let path = snapshot.with_file_name(format!(
            "{}.manifest.json",
            snapshot
                .file_name()
                .map(|name| name.to_string_lossy())
                .unwrap_or_default()
        ));
        if path.is_file() {
            SnapshotManifest::read(&path)?
                .completed(true)
                .write(data_directory)?;
        }
    }
    Ok(())
}

fn failed(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(Phase::SnapshotCopy, Refusal::SnapshotFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{external_roots, ExternalRoot};

    #[test]
    fn external_roots_are_named_not_discovered() {
        let directory = tempfile::tempdir().expect("create a data directory");
        std::fs::create_dir(directory.path().join("a-users-private-folder"))
            .expect("create an unrelated directory");
        let roots = external_roots(directory.path());
        assert!(roots
            .iter()
            .all(|root: &ExternalRoot| root.name != "a-users-private-folder"));
        assert!(roots.iter().any(|root| root.kind == "worktrees"));
        assert!(roots.iter().all(|root| !root.name.starts_with('/')));
    }

    #[test]
    fn a_present_root_is_recorded_as_present() {
        let directory = tempfile::tempdir().expect("create a data directory");
        std::fs::create_dir(directory.path().join("media")).expect("create the media root");
        let roots = external_roots(directory.path());
        assert!(roots
            .iter()
            .any(|root| root.kind == "attachments" && root.present));
    }
}
