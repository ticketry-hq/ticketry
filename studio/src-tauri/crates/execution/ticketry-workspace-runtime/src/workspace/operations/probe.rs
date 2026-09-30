//! Read-only inspection of the external state an operation describes.
//!
//! Recovery may never guess what a crashed worker did to the filesystem or to
//! Git. It asks this port what the re-resolved subject actually shows and
//! decides from the answer alone. A probe observes; it never creates, removes,
//! or repairs anything, and it receives no absolute path, command, or
//! credential — only the typed kind, the canonical resource key, and the
//! immutable intent it must match.

use async_trait::async_trait;
use serde_json::Value;

use super::{sanitize, WorkspaceOperationKind, WorkspaceOperationRecord};

/// Everything a probe is allowed to know.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationSubject {
    pub operation_id: String,
    pub kind: WorkspaceOperationKind,
    pub resource_key: String,
    /// The immutable intent payload the external state must match.
    pub payload: Value,
    /// Durable diagnostics a probe may use to bound its own work. They are
    /// facts about the operation, not permission to act on it.
    pub state: String,
    pub attempt_count: i32,
}

impl OperationSubject {
    /// `None` when this build has no typed decoder for the row, which is
    /// itself a reason to defer rather than probe.
    pub fn of(record: &WorkspaceOperationRecord) -> Option<Self> {
        Some(Self {
            operation_id: record.operation_id.clone(),
            kind: record.typed_kind()?,
            resource_key: record.resource_key.clone(),
            payload: record.intent_payload()?,
            state: record.state.clone(),
            attempt_count: record.attempt_count,
        })
    }
}

/// What the probe found under the re-resolved subject.
#[derive(Clone, Debug, PartialEq)]
pub enum ExternalObservation {
    /// The intended effect provably has not happened and no partial remnant
    /// survives. This is the only answer that permits acting.
    Absent,
    /// The intended effect is already durable in the world. It is adopted
    /// rather than performed a second time.
    Applied { evidence: Value },
    /// Something else holds the subject, or external state contradicts the
    /// intent. It is never overwritten, removed, or adopted.
    Conflicting { code: String, detail: String },
    /// The probe could not prove any of the above. Nothing is decided and the
    /// operation is left exactly as it was for the next pass.
    Uncertain { detail: String },
}

impl ExternalObservation {
    /// Probe output becomes durable evidence, so it is bounded and redacted
    /// before it can reach a row. A probe that reports something unusable is
    /// treated as uncertain rather than trusted.
    pub fn sanitized(self) -> Self {
        match self {
            Self::Absent => Self::Absent,
            Self::Applied { evidence } if evidence.is_object() => Self::Applied {
                evidence: sanitize::redact(&evidence),
            },
            Self::Applied { .. } => Self::Uncertain {
                detail: "The probe reported unusable adoption evidence.".to_owned(),
            },
            Self::Conflicting { code, detail } => {
                match (
                    sanitize::bounded_detail(&code),
                    sanitize::bounded_detail(&detail),
                ) {
                    (Some(code), Some(detail)) if code.len() <= 64 => Self::Conflicting {
                        code,
                        detail: sanitize::redact_text(&detail, 2000),
                    },
                    _ => Self::Uncertain {
                        detail: "The probe reported an unusable conflict description.".to_owned(),
                    },
                }
            }
            Self::Uncertain { detail } => Self::Uncertain {
                detail: sanitize::bounded_detail(&detail)
                    .map(|detail| sanitize::redact_text(&detail, 500))
                    .unwrap_or_else(|| "The external observation is unavailable.".to_owned()),
            },
        }
    }
}

#[async_trait]
pub trait WorkspaceStateProbe: Send + Sync {
    /// Observe the external state the subject would own. A probe that cannot
    /// answer returns `Uncertain` rather than guessing `Absent`, because only
    /// `Absent` permits a second attempt.
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation;
}

/// The idempotent performer of one claimed operation. It is invoked only after
/// a probe proved the effect absent.
#[async_trait]
pub trait WorkspaceOperationExecutor: Send + Sync {
    async fn execute(&self, claim: super::ClaimedOperation) -> super::WorkspaceOperationOutcome;
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn unusable_probe_output_degrades_to_uncertain_instead_of_reaching_a_row() {
        assert!(matches!(
            ExternalObservation::Applied {
                evidence: json!("not an object")
            }
            .sanitized(),
            ExternalObservation::Uncertain { .. }
        ));
        assert!(matches!(
            ExternalObservation::Conflicting {
                code: "worktree_path_taken".to_owned(),
                detail: "x".repeat(501),
            }
            .sanitized(),
            ExternalObservation::Uncertain { .. }
        ));
    }

    #[test]
    fn probe_evidence_and_detail_are_redacted_before_they_are_durable() {
        let ExternalObservation::Applied { evidence } = (ExternalObservation::Applied {
            evidence: json!({ "branch": "task/coding-756", "command": "git status" }),
        })
        .sanitized() else {
            panic!("adoption evidence should survive redaction");
        };
        assert_eq!(evidence["branch"], json!("task/coding-756"));
        assert_eq!(evidence["command"], json!(sanitize::REDACTED));

        let ExternalObservation::Conflicting { detail, .. } = (ExternalObservation::Conflicting {
            code: "worktree_path_taken".to_owned(),
            detail: "path /Users/someone/checkout belongs to another worktree".to_owned(),
        })
        .sanitized() else {
            panic!("a bounded conflict stays a conflict");
        };
        assert!(!detail.contains("/Users/someone"));
        assert!(detail.contains("another worktree"));
    }
}
