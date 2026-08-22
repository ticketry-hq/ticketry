//! The relative identities and digests the recovery journal remembers.
//!
//! A save's intent must survive a restart without becoming either an execution
//! surface or a durable copy of the document. It therefore holds no absolute
//! path and no bytes: only the document identity, its registered relative
//! path, a digest that identifies the authorized root without naming it, the
//! digest the caller loaded, the digest the caller intends, and how many bytes
//! that is. Recovery re-resolves the root from the current registry row and
//! compares the digest, so a document re-registered under a different root is
//! detected rather than written to.

use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::workspace_operations::{WorkspaceOperationIntent, WorkspaceOperationKind};

/// The intent schema version this build writes and decodes.
pub(crate) const INTENT_VERSION: i32 = 1;

/// A stable, path-free identity for one authorized design directory.
pub(crate) fn root_digest(root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The subject this operation acts on. One document is one subject, so an
/// undecidable save isolates that document alone and leaves every other
/// document converging.
pub(crate) fn resource_key(document_id: &str) -> String {
    format!("document/{document_id}")
}

/// The immutable intent of one save, in both directions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SaveIntent {
    pub(crate) document_id: String,
    pub(crate) rel_path: String,
    pub(crate) root_digest: String,
    /// The digest the caller loaded and is editing against.
    pub(crate) expected_digest: String,
    /// The digest of the bytes the caller intends to make durable.
    pub(crate) intended_digest: String,
    pub(crate) byte_length: i64,
}

impl SaveIntent {
    pub(crate) fn payload(&self) -> Value {
        json!({
            "documentId": self.document_id,
            "relPath": self.rel_path,
            "rootDigest": self.root_digest,
            "expectedDigest": self.expected_digest,
            "intendedDigest": self.intended_digest,
            "byteLength": self.byte_length,
        })
    }

    /// Decode one journalled payload. `None` means the row was written by a
    /// shape this build does not understand, which is a reason to defer rather
    /// than to guess.
    pub(crate) fn decode(payload: &Value) -> Option<Self> {
        Some(Self {
            document_id: field(payload, "documentId")?,
            rel_path: field(payload, "relPath")?,
            root_digest: field(payload, "rootDigest")?,
            expected_digest: field(payload, "expectedDigest")?,
            intended_digest: field(payload, "intendedDigest")?,
            byte_length: payload.get("byteLength").and_then(Value::as_i64)?,
        })
    }
}

pub(crate) fn intent(operation_id: &str, save: &SaveIntent) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation_id.to_owned(),
        kind: WorkspaceOperationKind::DocumentSave,
        intent_version: INTENT_VERSION,
        resource_key: resource_key(&save.document_id),
        payload: save.payload(),
    }
}

fn field(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn save() -> SaveIntent {
        SaveIntent {
            document_id: "d1".to_owned(),
            rel_path: "SPEC.md".to_owned(),
            root_digest: "a".repeat(64),
            expected_digest: "b".repeat(64),
            intended_digest: "c".repeat(64),
            byte_length: 12,
        }
    }

    #[test]
    fn the_same_root_reached_twice_has_one_identity() {
        assert_eq!(
            root_digest(Path::new("/design/T760")),
            root_digest(&PathBuf::from("/design/T760"))
        );
        assert_ne!(
            root_digest(Path::new("/design/T760")),
            root_digest(Path::new("/design/T759"))
        );
    }

    #[test]
    fn an_intent_round_trips_without_naming_a_local_path_or_carrying_bytes() {
        let payload = save().payload();
        assert_eq!(SaveIntent::decode(&payload), Some(save()));
        // Nothing in the payload is a body, a command, or an absolute path, so
        // the journal accepts it as immutable intent.
        assert!(
            intent(&uuid::Uuid::from_u128(1).hyphenated().to_string(), &save())
                .fingerprint()
                .is_ok()
        );
        assert!(SaveIntent::decode(&json!({ "documentId": "d1" })).is_none());
    }

    #[test]
    fn a_different_body_is_a_different_intent() {
        let one = intent("11111111-1111-1111-1111-111111111111", &save())
            .fingerprint()
            .unwrap();
        let mut edited = save();
        edited.intended_digest = "d".repeat(64);
        let two = intent("11111111-1111-1111-1111-111111111111", &edited)
            .fingerprint()
            .unwrap();
        assert_ne!(one, two);
    }
}
