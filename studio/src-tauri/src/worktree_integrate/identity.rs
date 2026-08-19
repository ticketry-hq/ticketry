//! The identity an automatic integration is keyed by, and the relative intent
//! its journal row is allowed to remember.
//!
//! Nobody asks for an integration, so nobody mints an operation ID for it. The
//! identity is *derived* from the two facts that make the request unique: the
//! Work Item whose checkout is landing, and the committed completion
//! occurrence that asked for it. Re-delivering the same occurrence therefore
//! lands on the same durable operation instead of starting a second one, and a
//! genuinely new completion — the retry after a hand-resolved conflict — is a
//! genuinely new operation.
//!
//! The intent itself holds relative identities only: no path, no command, no
//! caller-selected location. The repository is named by digest, so a module
//! repointed at a different repository is detected on recovery rather than
//! merged into.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::workspace_operations::{WorkspaceOperationIntent, WorkspaceOperationKind};

use super::plan::IntegrationPlan;

/// The intent schema version this build writes and decodes.
pub(crate) const INTENT_VERSION: i32 = 1;

/// The subject an integration acts on: the same checkout key creation and
/// discard use, so reconciliation isolates one ambiguous repository rather than
/// one capability.
pub(crate) fn resource_key(top_level_row_id: &str) -> String {
    crate::worktree_create::identity::resource_key(top_level_row_id)
}

/// The stable operation identity for one completion of one Work Item.
///
/// It is a digest rather than a random value precisely because nothing durable
/// remembers it: a second delivery of the same occurrence recomputes it and
/// finds the operation already prepared.
pub(crate) fn operation_id(top_level_row_id: &str, occurrence_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"worktree-integrate:");
    hasher.update(top_level_row_id.as_bytes());
    hasher.update(b":");
    hasher.update(occurrence_id.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    // A well-formed name-derived UUID: the journal stores identities as UUIDs,
    // and a derived one must not be mistaken for a randomly minted identity.
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).simple().to_string()
}

pub(crate) fn intent(plan: &IntegrationPlan, occurrence_id: &str) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation_id(&plan.top_level_row_id, occurrence_id),
        kind: WorkspaceOperationKind::WorktreeIntegrate,
        intent_version: INTENT_VERSION,
        resource_key: resource_key(&plan.top_level_row_id),
        payload: json!({
            "taskId": plan.top_level_row_id,
            "occurrenceId": occurrence_id,
            "branch": plan.branch,
            "checkoutName": plan.checkout_name,
            "baseRef": plan.base_ref,
            "repositoryDigest": plan.repository_digest,
        }),
    }
}

/// The immutable intent, as a later pass reads it back.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct IntegrateIntent {
    pub(crate) top_level_row_id: String,
    pub(crate) occurrence_id: String,
    pub(crate) branch: String,
    pub(crate) checkout_name: String,
    pub(crate) base_ref: String,
    pub(crate) repository_digest: String,
}

impl IntegrateIntent {
    /// Decode one journalled payload. `None` means the row was written by a
    /// shape this build does not understand, which is a reason to defer rather
    /// than to guess.
    pub(crate) fn decode(payload: &Value) -> Option<Self> {
        Some(Self {
            top_level_row_id: field(payload, "taskId")?,
            occurrence_id: field(payload, "occurrenceId")?,
            branch: field(payload, "branch")?,
            checkout_name: field(payload, "checkoutName")?,
            base_ref: field(payload, "baseRef")?,
            repository_digest: field(payload, "repositoryDigest")?,
        })
    }

    /// Whether the world still holds the exact checkout this operation was
    /// prepared against. A different branch, a different checkout, a different
    /// recorded base, or a different repository all mean the intent no longer
    /// describes anything that may be landed.
    pub(crate) fn matches(&self, plan: &IntegrationPlan) -> bool {
        self.branch == plan.branch
            && self.checkout_name == plan.checkout_name
            && self.base_ref == plan.base_ref
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
    use super::*;

    #[test]
    fn one_completion_of_one_work_item_has_exactly_one_operation_identity() {
        let owner = "60000000000000000000000000000001";
        let occurrence = "aa000000000000000000000000000001";
        assert_eq!(
            operation_id(owner, occurrence),
            operation_id(owner, occurrence),
            "re-delivering the same occurrence must land on the same operation"
        );
        assert_ne!(
            operation_id(owner, occurrence),
            operation_id(owner, "aa000000000000000000000000000002"),
            "a later completion is a new operation, which is what a retry needs"
        );
        assert_ne!(
            operation_id(owner, occurrence),
            operation_id("60000000000000000000000000000002", occurrence),
        );
        // The journal only stores UUID identities, so a derived one must parse
        // as one in either spelling.
        assert!(uuid::Uuid::parse_str(&operation_id(owner, occurrence)).is_ok());
    }

    #[test]
    fn a_decoded_intent_names_no_local_path() {
        let payload = json!({
            "taskId": "60000000000000000000000000000001",
            "occurrenceId": "aa000000000000000000000000000001",
            "branch": "wt/CODIN-881-parent-story",
            "checkoutName": "CODIN-881-parent-story",
            "baseRef": "main",
            "repositoryDigest": "a".repeat(64),
        });
        let decoded = IntegrateIntent::decode(&payload).expect("decode the intent");
        assert_eq!(decoded.base_ref, "main");
        assert!(WorkspaceOperationIntent {
            operation_id: operation_id("60000000000000000000000000000001", "aa"),
            kind: WorkspaceOperationKind::WorktreeIntegrate,
            intent_version: INTENT_VERSION,
            resource_key: resource_key("60000000000000000000000000000001"),
            payload,
        }
        .fingerprint()
        .is_ok());
        assert!(IntegrateIntent::decode(&json!({ "taskId": "x" })).is_none());
    }
}
