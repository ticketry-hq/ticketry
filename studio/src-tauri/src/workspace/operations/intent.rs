//! Immutable, versioned intent and its fingerprint.
//!
//! Intent is what a restart recovers an operation from, so it is normalized
//! once — here — before any comparison decides idempotency. The fingerprint is
//! a stable digest over the canonical form: reusing an operation ID with the
//! same fingerprint is a transport retry and returns the durable result;
//! reusing it with a different fingerprint is a typed conflict, never a
//! silent rebinding of a durable identity.

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{sanitize, WorkspaceOperationError, WorkspaceOperationKind};

/// One effectful request, in the only shape the journal will persist.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceOperationIntent {
    /// Stable identity. Studio mints one per user intent and reuses it for
    /// transport retries; internal callers derive a deterministic identity
    /// from the work they are keying.
    pub operation_id: String,
    pub kind: WorkspaceOperationKind,
    /// Schema version of `payload`, validated against the kind's decoders.
    pub intent_version: i32,
    /// Canonical relative identity of the subject the kind acts on.
    pub resource_key: String,
    pub payload: Value,
}

/// A validated intent. Only the journal can build one, so nothing downstream
/// has to re-check what a caller submitted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NormalizedIntent {
    pub operation_id: String,
    pub kind: WorkspaceOperationKind,
    pub intent_version: i32,
    pub resource_key: String,
    pub payload: Value,
    pub canonical: String,
    pub fingerprint: String,
}

impl WorkspaceOperationIntent {
    /// The digest a caller can compute to prove two requests are the same
    /// intent. It deliberately excludes the operation ID: identity and intent
    /// are separate facts, and comparing them separately is what makes replay
    /// distinguishable from rebinding.
    pub fn fingerprint(&self) -> Result<String, WorkspaceOperationError> {
        self.normalized().map(|intent| intent.fingerprint)
    }

    pub(crate) fn normalized(&self) -> Result<NormalizedIntent, WorkspaceOperationError> {
        let operation_id = database_uuid(&self.operation_id).ok_or_else(|| {
            WorkspaceOperationError::invalid("The Workspace Operation ID is not a UUID.")
        })?;
        self.kind.validate_version(self.intent_version)?;
        let resource_key = sanitize::usable_resource_key(&self.resource_key).ok_or_else(|| {
            WorkspaceOperationError::invalid(
                "The Workspace Operation resource key must be a bounded relative identity.",
            )
        })?;
        sanitize::validate_payload(&self.payload)?;

        let canonical = canonical_json(&serde_json::json!({
            "kind": self.kind.code(),
            "intentVersion": self.intent_version,
            "resourceKind": self.kind.resource_kind().code(),
            "resourceKey": resource_key,
            "payload": self.payload,
        }));
        Ok(NormalizedIntent {
            operation_id,
            kind: self.kind,
            intent_version: self.intent_version,
            resource_key,
            payload: self.payload.clone(),
            fingerprint: digest(&canonical),
            canonical,
        })
    }
}

/// Key-sorted JSON with no incidental whitespace. Written explicitly rather
/// than relying on a serializer's map ordering, because the fingerprint is a
/// durable comparison and must not change with a dependency's feature flags.
fn canonical_json(value: &Value) -> String {
    let mut rendered = String::new();
    write_canonical(value, &mut rendered);
    rendered
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(entries) => {
            let mut keys = entries.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical(&entries[key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

fn digest(canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The database stores identities unhyphenated, so every comparison happens on
/// one spelling regardless of which one the transport used.
pub(crate) fn database_uuid(value: &str) -> Option<String> {
    uuid::Uuid::parse_str(value.trim())
        .ok()
        .map(|value| value.simple().to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn intent(payload: Value) -> WorkspaceOperationIntent {
        WorkspaceOperationIntent {
            operation_id: uuid::Uuid::from_u128(1).hyphenated().to_string(),
            kind: WorkspaceOperationKind::DocumentSave,
            intent_version: 1,
            resource_key: "spec/design/SPEC.md".to_owned(),
            payload,
        }
    }

    #[test]
    fn the_fingerprint_ignores_field_order_and_identity_spelling() {
        let one = WorkspaceOperationIntent {
            operation_id: uuid::Uuid::from_u128(1).hyphenated().to_string(),
            ..intent(json!({ "expectedDigest": "aa", "intendedDigest": "bb" }))
        };
        let two = WorkspaceOperationIntent {
            operation_id: uuid::Uuid::from_u128(1).simple().to_string(),
            ..intent(json!({ "intendedDigest": "bb", "expectedDigest": "aa" }))
        };
        assert_eq!(one.fingerprint().unwrap(), two.fingerprint().unwrap());
        assert_eq!(
            one.normalized().unwrap().operation_id,
            two.normalized().unwrap().operation_id
        );
    }

    #[test]
    fn a_changed_value_changes_the_fingerprint() {
        let one = intent(json!({ "intendedDigest": "aa" }));
        let two = intent(json!({ "intendedDigest": "ab" }));
        assert_ne!(one.fingerprint().unwrap(), two.fingerprint().unwrap());
    }

    #[test]
    fn a_resource_key_may_not_be_an_absolute_path() {
        let mut absolute = intent(json!({}));
        absolute.resource_key = "/Users/someone/SPEC.md".to_owned();
        assert_eq!(
            absolute.fingerprint().unwrap_err().code(),
            super::super::WorkspaceOperationErrorCode::InvalidIntent
        );
    }
}
