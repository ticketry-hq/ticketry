//! The durable shape of one journalled operation.

use serde_json::Value;

use super::entities::operation as operation_entity;
use super::{WorkspaceOperationKind, WorkspaceResourceKind};

/// One row, as every caller in this capability sees it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceOperationRecord {
    pub operation_id: String,
    pub kind: String,
    pub intent_version: i32,
    pub resource_kind: String,
    pub resource_key: String,
    /// Canonical immutable intent, as stored.
    pub intent: String,
    pub intent_fingerprint: String,
    pub state: String,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub attempt_count: i32,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub evidence: Option<String>,
    pub result_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub settled_at: Option<String>,
}

/// The subject an operation acts on. Reconciliation isolates ambiguity by
/// this pair so one undecidable document cannot stall an unrelated repository.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ResourceIdentity {
    pub resource_kind: String,
    pub resource_key: String,
}

impl WorkspaceOperationRecord {
    pub fn resource(&self) -> ResourceIdentity {
        ResourceIdentity {
            resource_kind: self.resource_kind.clone(),
            resource_key: self.resource_key.clone(),
        }
    }

    /// The typed kind, or `None` for a row written by a future generation of
    /// the journal. Reconciliation defers such a row instead of guessing.
    pub fn typed_kind(&self) -> Option<WorkspaceOperationKind> {
        WorkspaceOperationKind::from_code(&self.kind).ok()
    }

    pub fn typed_resource_kind(&self) -> Option<WorkspaceResourceKind> {
        self.typed_kind().map(WorkspaceOperationKind::resource_kind)
    }

    /// The intent payload a typed decoder reads. An unparseable or
    /// unsupported-version row yields `None`.
    pub fn intent_payload(&self) -> Option<Value> {
        let kind = self.typed_kind()?;
        kind.validate_version(self.intent_version).ok()?;
        serde_json::from_str::<Value>(&self.intent)
            .ok()?
            .get("payload")
            .cloned()
    }

    /// The durable result of an applied operation, replayed to a caller that
    /// reused its identity.
    pub fn result(&self) -> Option<Value> {
        self.result_summary
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
    }

    pub fn evidence_value(&self) -> Option<Value> {
        self.evidence
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
    }

    /// True once the operation owes no further effect.
    pub fn is_terminal(&self) -> bool {
        matches!(self.state.as_str(), "applied" | "conflicted" | "failed")
    }
}

pub fn operation(row: operation_entity::Model) -> WorkspaceOperationRecord {
    WorkspaceOperationRecord {
        operation_id: row.operation_id,
        kind: row.kind,
        intent_version: row.intent_version,
        resource_kind: row.resource_kind,
        resource_key: row.resource_key,
        intent: row.intent,
        intent_fingerprint: row.intent_fingerprint,
        state: row.state,
        lease_owner: row.lease_owner,
        lease_expires_at: row.lease_expires_at,
        attempt_count: row.attempt_count,
        last_error_code: row.last_error_code,
        last_error_message: row.last_error_message,
        evidence: row.evidence,
        result_summary: row.result_summary,
        created_at: row.created_at,
        updated_at: row.updated_at,
        settled_at: row.settled_at,
    }
}
