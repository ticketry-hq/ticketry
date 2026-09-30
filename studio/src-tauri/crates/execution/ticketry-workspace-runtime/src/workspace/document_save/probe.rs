//! What a restart can actually see about a prepared save.
//!
//! Recovery never guesses what a crashed process did to a document. It
//! re-resolves the subject from the current registry row, looks at the file
//! and at the staged bytes beside it, and reports only what it can prove:
//!
//! * **Applied** — the file already holds the intended version *and* the
//!   registry already records it, so there is nothing left to write.
//! * **Absent** — the file holds either the expected version or the intended
//!   one. Both belong to this operation: the first is a save that never
//!   reached the disk, the second is a rename whose bookkeeping was lost, and
//!   the executor is the only thing allowed to act on either, because both
//!   converge through the same settlement transaction.
//! * **Conflicting** — the file holds some third version, the row is gone, or
//!   it now names a different file. Nothing is overwritten or removed.
//! * **Uncertain** — the row or the file could not be read at all. Nothing is
//!   decided and the operation waits for the next pass.

use async_trait::async_trait;

use crate::workspace::operations::{
    ExternalObservation, OperationSubject, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceStateProbe,
};

use super::executor::SaveExecutor;
use super::identity::SaveIntent;
use super::target;

pub struct SaveProbe {
    executor: SaveExecutor,
}

impl SaveProbe {
    pub fn new(executor: SaveExecutor) -> Self {
        Self { executor }
    }
}

#[async_trait]
impl WorkspaceStateProbe for SaveProbe {
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation {
        if subject.kind != WorkspaceOperationKind::DocumentSave {
            return ExternalObservation::Uncertain {
                detail: "This probe observes document saves only.".to_owned(),
            };
        }
        let Some(intent) = SaveIntent::decode(&subject.payload) else {
            return ExternalObservation::Uncertain {
                detail: "The prepared save intent cannot be decoded by this build.".to_owned(),
            };
        };
        let target = match self.executor.retarget(&intent).await {
            Ok(Ok(target)) => target,
            // A re-resolution that already decided the operation's fate says so
            // in the same vocabulary the reconciler understands.
            Ok(Err(WorkspaceOperationOutcome::Conflicted { code, message, .. })) => {
                return ExternalObservation::Conflicting {
                    code,
                    detail: message,
                }
            }
            Ok(Err(_)) => {
                return ExternalObservation::Uncertain {
                    detail: "The prepared save could not be re-resolved.".to_owned(),
                }
            }
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        };
        let Some(current) = target::current_digest(&target) else {
            return ExternalObservation::Uncertain {
                detail: "The document could not be read.".to_owned(),
            };
        };
        if current == intent.intended_digest {
            // The rename is durable. Only when the registry agrees is there
            // nothing left for the executor's settlement to commit.
            if target.row.content_digest.as_deref() == Some(intent.intended_digest.as_str()) {
                return ExternalObservation::Applied {
                    evidence: serde_json::json!({
                        "adopted": true,
                        "recorded": true,
                        "digest": intent.intended_digest,
                    }),
                };
            }
            return ExternalObservation::Absent;
        }
        if current == intent.expected_digest {
            // Either the staged bytes survived and the rename can be finished,
            // or nothing was staged and this save simply never happened. Both
            // leave one file version, so both are the executor's to settle.
            return ExternalObservation::Absent;
        }
        ExternalObservation::Conflicting {
            code: super::executor::STALE_CODE.to_owned(),
            detail: format!(
                "This document holds a version the prepared save did not expect ({current})."
            ),
        }
    }
}
