//! What a restart can actually see about a prepared creation.
//!
//! Recovery never guesses what a crashed process did. It re-resolves the
//! subject from current trusted state, looks at the index and at Git, and
//! reports only what it can prove:
//!
//! * **Applied** — the index already records this exact checkout, so the
//!   operation is adopted rather than performed again.
//! * **Absent** — nothing holds the intended path or branch on behalf of
//!   anyone else. This includes the crash window where Git already cut the
//!   checkout but its row never committed: that checkout belongs to *this*
//!   operation, and re-executing adopts it instead of cutting a second one,
//!   which is why the executor is the only thing allowed to act on this
//!   answer.
//! * **Conflicting** — an occupied path, a foreign registration, a branch
//!   checked out elsewhere, a pre-existing branch, or a Work Item that now
//!   resolves to a different repository. Nothing is removed or reset.
//! * **Uncertain** — the owner, the repository, or Git could not be read at
//!   all. Nothing is decided and the operation waits for the next pass.

use async_trait::async_trait;

use crate::workspace_operations::{
    ExternalObservation, OperationSubject, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceStateProbe,
};

use super::executor::CreateExecutor;
use super::git_effects::{self, CheckoutObservation};
use super::identity::CreateIntent;

pub(crate) struct CreateProbe {
    executor: CreateExecutor,
}

impl CreateProbe {
    pub(crate) fn new(executor: CreateExecutor) -> Self {
        Self { executor }
    }
}

#[async_trait]
impl WorkspaceStateProbe for CreateProbe {
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation {
        if subject.kind != WorkspaceOperationKind::WorktreeCreate {
            return ExternalObservation::Uncertain {
                detail: "This probe observes worktree creation only.".to_owned(),
            };
        }
        let Some(intent) = CreateIntent::decode(&subject.payload) else {
            return ExternalObservation::Uncertain {
                detail: "The prepared worktree intent cannot be decoded by this build.".to_owned(),
            };
        };
        let plan = match self.executor.replan(&intent).await {
            Ok(Ok(plan)) => plan,
            // A re-derivation that already decided the operation's fate says so
            // in the same vocabulary the reconciler understands.
            Ok(Err(WorkspaceOperationOutcome::Conflicted { code, message, .. })) => {
                return ExternalObservation::Conflicting {
                    code,
                    detail: message,
                }
            }
            Ok(Err(outcome)) => {
                return ExternalObservation::Uncertain {
                    detail: match outcome {
                        WorkspaceOperationOutcome::Failed { message, .. } => message,
                        _ => "The prepared worktree could not be re-derived.".to_owned(),
                    },
                }
            }
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        };

        match super::row_for(self.executor.work_items(), &plan).await {
            Ok(Some(row)) if row.branch == intent.branch => {
                return ExternalObservation::Applied {
                    evidence: serde_json::json!({
                        "indexed": true,
                        "branch": row.branch,
                        "baseRef": row.base_branch,
                        "baseCommit": row.base_commit,
                    }),
                }
            }
            Ok(Some(row)) => {
                return ExternalObservation::Conflicting {
                    code: "worktree_row_mismatch".to_owned(),
                    detail: format!(
                    "This Work Item already indexes the branch {} rather than the intended one.",
                    row.branch
                ),
                }
            }
            Ok(None) => {}
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        }

        match git_effects::observe(
            self.executor.git(),
            &plan.repository,
            &plan.checkout,
            &plan.branch,
        )
        .await
        {
            // Either nothing exists yet, or this operation's own checkout
            // survives without its row. The executor adopts the second case
            // under the repository lock rather than cutting a second one.
            Ok(CheckoutObservation::Clear | CheckoutObservation::Matching { .. }) => {
                ExternalObservation::Absent
            }
            Ok(CheckoutObservation::Conflicting { code, detail }) => {
                ExternalObservation::Conflicting { code, detail }
            }
            Err(error) => ExternalObservation::Uncertain {
                detail: error.to_string(),
            },
        }
    }
}
