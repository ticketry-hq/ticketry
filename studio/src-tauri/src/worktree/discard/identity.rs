//! The relative identities a prepared discard is allowed to remember.
//!
//! A discard is the destructive operation in this capability, so what the
//! journal stores is deliberately the *narrowest* description of its subject:
//! the indexed row's own identity, its owning Work Item, the task branch, the
//! checkout's directory name, and a digest that identifies the repository
//! without naming it. There is no path, no command, and no force flag, so a
//! journal row can never be read back as permission to delete something else.
//!
//! Recovery re-reads the row by that identity and compares every remembered
//! field against it. A row that now indexes a different branch, a different
//! directory, or a different repository is a conflict, never a wider removal.

use serde_json::{json, Value};

use crate::workspace::operations::{WorkspaceOperationIntent, WorkspaceOperationKind};
use crate::worktree::create::identity::resource_key;

use super::cleanup::CleanupExpectation;
use super::plan::DiscardPlan;

/// The intent schema version this build writes and decodes.
pub(crate) const INTENT_VERSION: i32 = 1;

pub(crate) fn intent(operation_id: &str, plan: &DiscardPlan) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation_id.to_owned(),
        kind: WorkspaceOperationKind::WorktreeDiscard,
        intent_version: INTENT_VERSION,
        // One Work Item owns one checkout, so a discard, a creation, and an
        // integration of the same checkout name the same subject and are
        // isolated together when one of them cannot be decided.
        resource_key: resource_key(&plan.top_level_row_id),
        payload: payload(plan),
    }
}

pub(crate) fn cleanup_intent(
    operation_id: &str,
    plan: &DiscardPlan,
    expectation: &CleanupExpectation,
) -> WorkspaceOperationIntent {
    let mut payload = payload(plan);
    payload["cleanup"] = json!({
        "pullRequestUrl": expectation.pull_request_url,
        "headCommit": expectation.head_commit,
    });
    WorkspaceOperationIntent {
        operation_id: operation_id.to_owned(),
        kind: WorkspaceOperationKind::WorktreeDiscard,
        intent_version: INTENT_VERSION,
        resource_key: resource_key(&plan.top_level_row_id),
        payload,
    }
}

fn payload(plan: &DiscardPlan) -> Value {
    json!({
        "worktreeId": plan.worktree_id,
        "taskId": plan.top_level_row_id,
        "branch": plan.branch,
        "checkoutName": plan.checkout_name,
        "repositoryDigest": plan.repository_digest,
    })
}

/// The immutable intent, as a later pass reads it back.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiscardIntent {
    pub(crate) worktree_id: String,
    pub(crate) top_level_row_id: String,
    pub(crate) branch: String,
    pub(crate) checkout_name: String,
    pub(crate) repository_digest: String,
    pub(crate) cleanup: Option<CleanupExpectation>,
}

impl DiscardIntent {
    /// Decode one journalled payload. `None` means the row was written by a
    /// shape this build does not understand, which is a reason to defer rather
    /// than to guess — and a guess here would remove something.
    pub(crate) fn decode(payload: &Value) -> Option<Self> {
        let cleanup = match payload.get("cleanup") {
            Some(cleanup) => Some(CleanupExpectation {
                pull_request_url: field(cleanup, "pullRequestUrl")?,
                head_commit: field(cleanup, "headCommit")?,
            }),
            None => None,
        };
        Some(Self {
            worktree_id: field(payload, "worktreeId")?,
            top_level_row_id: field(payload, "taskId")?,
            branch: field(payload, "branch")?,
            checkout_name: field(payload, "checkoutName")?,
            repository_digest: field(payload, "repositoryDigest")?,
            cleanup,
        })
    }

    /// Whether the row a later pass found is still the row this operation was
    /// prepared against. Every remembered identity must agree.
    pub(crate) fn matches(&self, plan: &DiscardPlan) -> bool {
        self.worktree_id == plan.worktree_id
            && self.top_level_row_id == plan.top_level_row_id
            && self.branch == plan.branch
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
    use super::*;

    fn payload_value() -> Value {
        json!({
            "worktreeId": "aa11",
            "taskId": "60000000000000000000000000000001",
            "branch": "wt/CODIN-881-parent-story",
            "checkoutName": "CODIN-881-parent-story",
            "repositoryDigest": "a".repeat(64),
        })
    }

    #[test]
    fn a_decoded_intent_round_trips_without_naming_a_local_path() {
        let decoded = DiscardIntent::decode(&payload_value()).expect("decode the intent");
        assert_eq!(decoded.branch, "wt/CODIN-881-parent-story");
        assert_eq!(decoded.worktree_id, "aa11");
        // Nothing in the intent is a local path or a command: the journal
        // accepts every value it carries.
        assert!(WorkspaceOperationIntent {
            operation_id: uuid::Uuid::from_u128(1).hyphenated().to_string(),
            kind: WorkspaceOperationKind::WorktreeDiscard,
            intent_version: INTENT_VERSION,
            resource_key: resource_key("60000000000000000000000000000001"),
            payload: payload_value(),
        }
        .fingerprint()
        .is_ok());
    }

    #[test]
    fn an_incomplete_intent_is_refused_rather_than_partially_decoded() {
        for missing in [
            "worktreeId",
            "taskId",
            "branch",
            "checkoutName",
            "repositoryDigest",
        ] {
            let mut payload = payload_value();
            payload
                .as_object_mut()
                .expect("an object payload")
                .remove(missing);
            assert!(
                DiscardIntent::decode(&payload).is_none(),
                "a discard missing {missing} must not decode"
            );
        }
    }
}
