//! The relative identities the recovery journal is allowed to remember.
//!
//! A Workspace Operation intent must survive a restart without becoming an
//! execution surface, so it never holds an absolute path. What it holds
//! instead is this: the owning Work Item, the derived branch, the derived
//! checkout *name*, and a digest that identifies the repository without
//! naming it. Recovery re-derives the absolute path from the currently
//! configured module folder and compares the digest, so a module repointed at
//! a different repository is detected rather than acted on.

use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::workspace::operations::{WorkspaceOperationIntent, WorkspaceOperationKind};

use super::plan::CreatePlan;

/// The intent schema version this build writes and decodes.
pub(crate) const INTENT_VERSION: i32 = 1;

/// A stable, path-free identity for one canonical repository.
pub(crate) fn repository_digest(repository: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(repository.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The subject this operation acts on. One task owns one checkout, so an
/// ambiguous creation isolates that task alone and leaves every other
/// repository converging.
pub(crate) fn resource_key(top_level_row_id: &str) -> String {
    format!("worktree/{top_level_row_id}")
}

pub(crate) fn intent(operation_id: &str, plan: &CreatePlan) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation_id.to_owned(),
        kind: WorkspaceOperationKind::WorktreeCreate,
        intent_version: INTENT_VERSION,
        resource_key: resource_key(&plan.owner.top_level_row_id()),
        payload: payload(plan),
    }
}

fn payload(plan: &CreatePlan) -> Value {
    json!({
        "taskId": plan.owner.top_level_row_id(),
        "branch": plan.branch,
        "checkoutName": plan.checkout_name,
        "repositoryDigest": plan.repository_digest,
    })
}

/// The immutable intent, as a later pass reads it back.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CreateIntent {
    pub(crate) top_level_row_id: String,
    pub(crate) branch: String,
    pub(crate) checkout_name: String,
    pub(crate) repository_digest: String,
}

impl CreateIntent {
    /// Decode one journalled payload. `None` means the row was written by a
    /// shape this build does not understand, which is a reason to defer rather
    /// than to guess.
    pub(crate) fn decode(payload: &Value) -> Option<Self> {
        Some(Self {
            top_level_row_id: field(payload, "taskId")?,
            branch: field(payload, "branch")?,
            checkout_name: field(payload, "checkoutName")?,
            repository_digest: field(payload, "repositoryDigest")?,
        })
    }

    /// Whether a freshly derived plan still describes the same checkout. A
    /// mismatch means the world moved under a journalled operation.
    pub(crate) fn matches(&self, plan: &CreatePlan) -> bool {
        self.branch == plan.branch
            && self.checkout_name == plan.checkout_name
            && self.repository_digest == plan.repository_digest
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

    #[test]
    fn the_same_repository_reached_twice_has_one_identity() {
        assert_eq!(
            repository_digest(Path::new("/repositories/ticketry")),
            repository_digest(&PathBuf::from("/repositories/ticketry"))
        );
        assert_ne!(
            repository_digest(Path::new("/repositories/ticketry")),
            repository_digest(Path::new("/repositories/other"))
        );
    }

    #[test]
    fn a_decoded_intent_round_trips_without_naming_a_local_path() {
        let payload = json!({
            "taskId": "60000000000000000000000000000001",
            "branch": "wt/CODIN-881-parent-story",
            "checkoutName": "CODIN-881-parent-story",
            "repositoryDigest": "a".repeat(64),
        });
        let decoded = CreateIntent::decode(&payload).expect("decode the intent");
        assert_eq!(decoded.branch, "wt/CODIN-881-parent-story");
        // Nothing in the intent is a local path: every value is a relative
        // identity the journal will accept.
        assert!(crate::workspace::operations::WorkspaceOperationIntent {
            operation_id: uuid::Uuid::from_u128(1).hyphenated().to_string(),
            kind: WorkspaceOperationKind::WorktreeCreate,
            intent_version: INTENT_VERSION,
            resource_key: resource_key("60000000000000000000000000000001"),
            payload,
        }
        .fingerprint()
        .is_ok());
        assert!(CreateIntent::decode(&json!({ "taskId": "x" })).is_none());
    }
}
