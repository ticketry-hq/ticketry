//! What a restart can actually see about an interrupted integration.
//!
//! One answer is deliberately unreachable here: **Applied**. Adoption settles
//! an operation without performing its model write, and an integration's model
//! write — deleting the index row — commits in the same transaction as its
//! settlement. So a landing is never "already durable" while its operation is
//! still open; concluding that from a removed checkout, a deleted branch, or a
//! missing row is exactly the inference this slice forbids.
//!
//! What the probe decides instead is narrow:
//!
//! * **Conflicting** — the Work Item now indexes a different checkout, the row
//!   is gone underneath the operation, the module points at another repository,
//!   or the recorded base is no longer a branch. Nothing is landed on a guess.
//! * **Uncertain** — the owner, the repository, or Git could not be read.
//!   Nothing is decided and the operation waits for the next pass.
//! * **Absent** — everything else. It does not mean nothing happened; it means
//!   the operation still owes work, and only the executor may decide which of
//!   its steps are already proved.

use async_trait::async_trait;

use crate::workspace_operations::{
    ExternalObservation, OperationSubject, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceStateProbe,
};

use super::executor::IntegrateExecutor;
use super::identity::IntegrateIntent;

pub(crate) struct IntegrateProbe {
    executor: IntegrateExecutor,
}

impl IntegrateProbe {
    pub(crate) fn new(executor: IntegrateExecutor) -> Self {
        Self { executor }
    }
}

#[async_trait]
impl WorkspaceStateProbe for IntegrateProbe {
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation {
        if subject.kind != WorkspaceOperationKind::WorktreeIntegrate {
            return ExternalObservation::Uncertain {
                detail: "This probe observes worktree integration only.".to_owned(),
            };
        }
        let Some(intent) = IntegrateIntent::decode(&subject.payload) else {
            return ExternalObservation::Uncertain {
                detail: "The prepared integration intent cannot be decoded by this build."
                    .to_owned(),
            };
        };
        match self.executor.replan(&intent).await {
            // The subject still describes exactly one landing. Which of its
            // steps already happened is a question only the executor answers,
            // under the repository lock and from Git ancestry.
            Ok(Ok(_)) => ExternalObservation::Absent,
            Ok(Err(WorkspaceOperationOutcome::Conflicted { code, message, .. })) => {
                ExternalObservation::Conflicting {
                    code,
                    detail: message,
                }
            }
            Ok(Err(outcome)) => ExternalObservation::Uncertain {
                detail: match outcome {
                    WorkspaceOperationOutcome::Failed { message, .. } => message,
                    _ => "The prepared integration could not be re-derived.".to_owned(),
                },
            },
            Err(error) => ExternalObservation::Uncertain {
                detail: error.to_string(),
            },
        }
    }
}
