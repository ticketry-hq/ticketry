//! Staging, flushing, and atomically replacing one document file.
//!
//! The bytes a save intends never live in the journal, so the staged file *is*
//! the durable record of them. That makes its name part of the protocol: it is
//! derived from the operation identity, so a restart can find exactly the file
//! its own operation wrote, prove it is intact against the journalled digest,
//! and finish the rename instead of losing the edit.
//!
//! Two guarantees make the window between staging and settlement survivable.
//! The staged file is flushed to the device before it is renamed, so a
//! surviving staged file is either complete or provably corrupt; and the
//! rename is a same-directory `rename(2)`, so the primary file is only ever
//! the old version or the new one, never a half-written one.

use std::io;
use std::path::{Path, PathBuf};

use ticketry_documents::asset_access;

/// The name every Ticketry staging file starts with. Conservative cleanup
/// removes nothing that does not match it, so a person's own dotfile inside a
/// design directory is never a candidate.
pub const STAGING_PREFIX: &str = ".ticketry-save-";

/// The suffix a staging file carries. It is deliberately not a document
/// extension, so discovery never registers a half-written save as a document.
const STAGING_SUFFIX: &str = ".part";

/// The name of the staged file one operation owns. It is part of the recovery
/// contract rather than an implementation detail: a restart finds its own
/// staged bytes by this name, and conservative cleanup recognises Ticketry's
/// own files by it.
pub fn staging_file_name(operation_id: &str) -> String {
    format!("{STAGING_PREFIX}{operation_id}{STAGING_SUFFIX}")
}

/// The staged file one operation owns, beside the file it will replace.
pub(crate) fn staging_path(directory: &Path, operation_id: &str) -> PathBuf {
    directory.join(staging_file_name(operation_id))
}

/// The operation a staging file name belongs to, or `None` when the name is
/// not one Ticketry wrote.
pub(crate) fn staged_operation(name: &str) -> Option<String> {
    let identity = name
        .strip_prefix(STAGING_PREFIX)?
        .strip_suffix(STAGING_SUFFIX)?;
    uuid::Uuid::parse_str(identity)
        .ok()
        .map(|identity| identity.simple().to_string())
}

/// Every Ticketry staging file in one directory, with the operation each
/// belongs to. Anything else in the directory is not returned at all.
pub(crate) fn staging_files(directory: &Path) -> Vec<(PathBuf, String)> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut found: Vec<(PathBuf, String)> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            staged_operation(&name).map(|operation| (entry.path(), operation))
        })
        .collect();
    found.sort();
    found
}

/// The digest of a staged file, or `None` when nothing readable is staged.
pub(crate) fn staged_digest(path: &Path) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|bytes| asset_access::digest(&bytes))
}

/// Write the intended bytes into the operation's staged file and flush them to
/// the device before anything else can depend on them.
pub(crate) fn stage(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;

    let mut file = std::fs::File::create(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    file.sync_all()
}

/// Replace the primary file with the staged one and flush the directory entry,
/// so the rename itself survives a crash rather than only the bytes.
pub(crate) fn commit(staged: &Path, target: &Path) -> io::Result<()> {
    std::fs::rename(staged, target)?;
    if let Some(directory) = target.parent() {
        // A directory that cannot be opened for sync is not a failed save: the
        // rename is already durable on every filesystem Studio supports.
        if let Ok(handle) = std::fs::File::open(directory) {
            let _ = handle.sync_all();
        }
    }
    Ok(())
}

/// Remove one staged file. Absence is success: cleanup is about the file not
/// being there afterwards.
pub(crate) fn discard(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ticketry_staging_names_are_recognised() {
        let operation = uuid::Uuid::from_u128(7).simple().to_string();
        assert_eq!(
            staged_operation(&staging_file_name(&operation)),
            Some(operation)
        );
        for foreign in [
            "SPEC.md",
            ".DS_Store",
            ".ticketry-save-not-a-uuid.part",
            ".ticketry-save-.part",
            "ticketry-save-00000000000000000000000000000001.part",
        ] {
            assert_eq!(staged_operation(foreign), None, "{foreign} is not ours");
        }
    }

    #[test]
    fn a_staged_file_is_flushed_and_then_replaces_its_target_atomically() {
        let directory = tempfile::tempdir().expect("create a design directory");
        let target = directory.path().join("SPEC.md");
        std::fs::write(&target, b"# old").expect("write the primary document");
        let operation = uuid::Uuid::from_u128(9).simple().to_string();
        let staged = staging_path(directory.path(), &operation);

        stage(&staged, b"# new").expect("stage the intended bytes");
        assert_eq!(staged_digest(&staged), Some(asset_access::digest(b"# new")));
        assert_eq!(
            staging_files(directory.path()),
            vec![(staged.clone(), operation)]
        );

        commit(&staged, &target).expect("replace the primary document");
        assert_eq!(std::fs::read(&target).unwrap(), b"# new");
        assert!(!staged.exists());
        assert!(staging_files(directory.path()).is_empty());
    }
}
