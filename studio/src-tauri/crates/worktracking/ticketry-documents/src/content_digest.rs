//! The digest that says whether a registered document's bytes changed.
//!
//! It is the registry's only claim about content. The bytes stay on disk; the
//! row keeps a fingerprint so a rescan can tell "the same file" from "the same
//! path holding something new" without publishing a fact for every touch.
//!
//! An unreadable file has no digest rather than an error digest: the file is
//! either about to be pruned or about to be re-read, and inventing a value
//! would publish a change that never happened.

use std::path::Path;

use sha2::{Digest, Sha256};

/// The hex SHA-256 of one document's bytes, or `None` when it cannot be read.
pub(super) fn digest_of(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_bytes_produce_the_same_digest_and_new_bytes_do_not() {
        let directory = tempfile::tempdir().expect("create a document directory");
        let path = directory.path().join("SPEC.md");
        std::fs::write(&path, "# spec").expect("write the document");
        let first = digest_of(&path).expect("digest the document");

        std::fs::write(&path, "# spec").expect("rewrite identical bytes");
        assert_eq!(digest_of(&path), Some(first.clone()));

        std::fs::write(&path, "# spec\nmore").expect("rewrite new bytes");
        assert_ne!(digest_of(&path), Some(first));
    }

    #[test]
    fn a_missing_file_has_no_digest() {
        let directory = tempfile::tempdir().expect("create a document directory");

        assert_eq!(digest_of(&directory.path().join("absent.md")), None);
    }
}
