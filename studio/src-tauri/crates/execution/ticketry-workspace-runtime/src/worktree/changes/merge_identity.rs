use serde_json::{json, Value};

use crate::workspace::operations::{WorkspaceOperationIntent, WorkspaceOperationKind};
use crate::worktree::create;

pub const INTENT_VERSION: i32 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct MergeIntent {
    pub worktree_id: String,
    pub task_id: String,
    pub repository_digest: String,
    pub source_branch: String,
    pub source_commit: String,
    pub destination_branch: String,
    pub destination_commit: String,
    pub destination_checkout_identity: String,
    pub action: String,
}

pub(super) fn intent(operation_id: &str, value: &MergeIntent) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation_id.to_owned(),
        kind: WorkspaceOperationKind::WorktreeMerge,
        intent_version: INTENT_VERSION,
        resource_key: create::identity::resource_key(&value.task_id),
        payload: json!({
            "worktreeId": value.worktree_id,
            "taskId": value.task_id,
            "repositoryDigest": value.repository_digest,
            "sourceBranch": value.source_branch,
            "sourceCommit": value.source_commit,
            "destinationBranch": value.destination_branch,
            "destinationCommit": value.destination_commit,
            "destinationCheckoutIdentity": value.destination_checkout_identity,
            "action": value.action,
        }),
    }
}

impl MergeIntent {
    pub(super) fn decode(payload: &Value) -> Option<Self> {
        Some(Self {
            worktree_id: field(payload, "worktreeId")?,
            task_id: field(payload, "taskId")?,
            repository_digest: field(payload, "repositoryDigest")?,
            source_branch: field(payload, "sourceBranch")?,
            source_commit: field(payload, "sourceCommit")?,
            destination_branch: field(payload, "destinationBranch")?,
            destination_commit: field(payload, "destinationCommit")?,
            destination_checkout_identity: field(payload, "destinationCheckoutIdentity")?,
            action: field(payload, "action")?,
        })
    }
}

fn field(payload: &Value, name: &str) -> Option<String> {
    payload
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}
