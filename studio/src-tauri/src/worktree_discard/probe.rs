//! What a restart can actually see about a prepared discard.
//!
//! Recovery never guesses what a crashed process removed. It re-reads the
//! indexed row, looks at Git, and reports only what it can prove:
//!
//! * **Applied** — the row this operation was prepared against is gone. The
//!   row is deleted in the same transaction that settles the operation, so its
//!   absence means the discard already completed.
//! * **Absent** — the row still exists and nothing foreign holds its path or
//!   its branch. "Absent" here means *the intended end state has not been
//!   reached*, which is the only answer that permits acting; the executor then
//!   completes whichever of the three steps Git still owes.
//! * **Conflicting** — the recorded path is registered to another branch, is
//!   occupied by something Git does not track, the task branch is checked out
//!   elsewhere, or the row itself now describes a different subject. Nothing is
//!   removed, pruned, or reset.
//! * **Uncertain** — the index or Git could not be read at all. Nothing is
//!   decided and the operation waits for the next pass.

use async_trait::async_trait;

use crate::workspace_operations::{
    ExternalObservation, OperationSubject, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceStateProbe,
};

use super::executor::{DiscardExecutor, Subject};
use super::git_effects;
use super::identity::DiscardIntent;

pub(crate) struct DiscardProbe {
    executor: DiscardExecutor,
}

impl DiscardProbe {
    pub(crate) fn new(executor: DiscardExecutor) -> Self {
        Self { executor }
    }
}

#[async_trait]
impl WorkspaceStateProbe for DiscardProbe {
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation {
        if subject.kind != WorkspaceOperationKind::WorktreeDiscard {
            return ExternalObservation::Uncertain {
                detail: "This probe observes worktree discard only.".to_owned(),
            };
        }
        let Some(intent) = DiscardIntent::decode(&subject.payload) else {
            return ExternalObservation::Uncertain {
                detail: "The prepared worktree discard cannot be decoded by this build."
                    .to_owned(),
            };
        };
        let plan = match self.executor.resubject(&intent).await {
            Ok(Subject::Indexed(plan)) => plan,
            Ok(Subject::Absent) => {
                return ExternalObservation::Applied {
                    evidence: serde_json::json!({
                        "indexed": false,
                        "branch": intent.branch,
                    }),
                }
            }
            // A re-read that already decided the operation's fate says so in
            // the same vocabulary the reconciler understands.
            Ok(Subject::Mismatched(WorkspaceOperationOutcome::Conflicted {
                code, message, ..
            })) => {
                return ExternalObservation::Conflicting {
                    code,
                    detail: message,
                }
            }
            Ok(Subject::Mismatched(_)) => {
                return ExternalObservation::Uncertain {
                    detail: "The prepared worktree discard could not be re-read.".to_owned(),
                }
            }
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        };

        match git_effects::observe(
            self.executor.git(),
            &plan.repository,
            &plan.checkout,
            &plan.branch,
        )
        .await
        {
            Ok(observation) => match observation.conflict() {
                Some((code, detail)) => ExternalObservation::Conflicting {
                    code: code.to_owned(),
                    detail: detail.to_owned(),
                },
                // Either nothing has been removed yet, or a crash left part of
                // the removal done and the row still indexing it. Both are the
                // same instruction: run the executor, which completes only the
                // steps Git still owes.
                None => ExternalObservation::Absent,
            },
            Err(error) => ExternalObservation::Uncertain {
                detail: error.to_string(),
            },
        }
    }
}
