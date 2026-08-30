//! The one idempotent performer of a prepared discard.
//!
//! Both paths that can remove a checkout — a user confirming in Studio and
//! startup reconciliation draining the journal — run exactly this code under
//! exactly one claim, so there is a single place where the repository lock is
//! held, Git is inspected, the checkout, record, and branch are removed, and
//! the row, the fact, and the operation settle together.
//!
//! Four rules bound what a repetition can do:
//!
//! * **Nothing is derived from the journal.** The intent carries relative
//!   identities only; the subject is re-read from the index row and then
//!   *compared* with the intent. A row that now indexes a different branch,
//!   directory, or repository is a conflict, not a wider removal.
//! * **Git is asked before it is told.** Each of the three steps runs only if
//!   the observation says it is still owed, so a crash between them is
//!   completed rather than repeated, and a path or ref that now belongs to
//!   someone else stops the operation instead of being force-cleaned.
//! * **The database only ever follows Git.** The row is deleted and the fact
//!   appended inside the settlement transaction, after Git has released the
//!   checkout and the ref.
//! * **No database transaction is open across Git.** The lock serializes the
//!   repository; SQLite is touched before and after, never during.

use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::json;

use crate::entities::worktrees::worktree;
use crate::runs_persistence::StatusEventRepository;
use crate::workspace::operations::{
    ClaimedOperation, WorkspaceOperationExecutor, WorkspaceOperationJournal,
    WorkspaceOperationOutcome,
};
use crate::worktree::status::{GitPort, RepositoryLocks};

use super::cleanup::{self, CleanupExpectation};
use super::error::WorktreeDiscardError;
use super::git_effects::{self, BranchState, CheckoutState, DiscardObservation};
use super::identity::DiscardIntent;
use super::plan::DiscardPlan;
use super::settlement::{self, Removal};

/// Everything a discard needs that is not derived per request.
#[derive(Clone)]
pub(crate) struct DiscardExecutor {
    work_items: DatabaseConnection,
    journal: WorkspaceOperationJournal,
    events: Option<StatusEventRepository>,
    locks: RepositoryLocks,
    git: GitPort,
}

/// What re-reading a journalled intent against current state concluded.
pub(crate) enum Subject {
    /// The row this operation was prepared against is still exactly itself.
    Indexed(DiscardPlan),
    /// The row is gone, so this operation's subject no longer exists. Nothing
    /// remains for it to remove.
    Absent,
    /// The row exists but is no longer what the intent described.
    Mismatched(WorkspaceOperationOutcome),
}

impl DiscardExecutor {
    pub(crate) fn new(
        work_items: DatabaseConnection,
        journal: WorkspaceOperationJournal,
        events: Option<StatusEventRepository>,
        locks: RepositoryLocks,
    ) -> Self {
        Self {
            work_items,
            journal,
            events,
            locks,
            git: GitPort::new(),
        }
    }

    pub(crate) fn work_items(&self) -> &DatabaseConnection {
        &self.work_items
    }

    pub(crate) fn git(&self) -> &GitPort {
        &self.git
    }

    pub(crate) fn journal(&self) -> &WorkspaceOperationJournal {
        &self.journal
    }

    pub(crate) async fn prepare_cleanup(
        &self,
        plan: &DiscardPlan,
    ) -> Result<CleanupExpectation, WorktreeDiscardError> {
        let _guard = self.locks.acquire(&plan.repository).await;
        cleanup::verify(&self.work_items, &self.git, plan).await
    }

    /// Re-read the row a journalled intent describes and prove it is still the
    /// same subject.
    pub(crate) async fn resubject(
        &self,
        intent: &DiscardIntent,
    ) -> Result<Subject, WorktreeDiscardError> {
        let Some(row) = worktree::Entity::find_by_id(intent.worktree_id.clone())
            .one(&self.work_items)
            .await?
        else {
            return Ok(Subject::Absent);
        };
        let plan = DiscardPlan::for_row(&row);
        if !intent.matches(&plan) {
            return Ok(Subject::Mismatched(conflicted(
                "worktree_row_mismatch",
                "This worktree now indexes a different branch, checkout, or repository than the prepared discard intended.",
                json!({
                    "intendedBranch": intent.branch,
                    "intendedCheckoutName": intent.checkout_name,
                    "indexedBranch": plan.branch,
                    "indexedCheckoutName": plan.checkout_name,
                    "repositoryMatches": intent.repository_digest == plan.repository_digest,
                }),
            )));
        }
        Ok(Subject::Indexed(plan))
    }

    /// Perform one claimed discard, from the repository lock through
    /// settlement.
    pub(crate) async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
        let Some(intent) = DiscardIntent::decode(&claim.payload) else {
            return WorkspaceOperationOutcome::Failed {
                code: "worktree_intent_undecodable".to_owned(),
                message: "The prepared worktree discard cannot be decoded by this build."
                    .to_owned(),
                retryable: false,
                cleanup_confirmed: true,
            };
        };
        // The first read only says which repository to serialize on.
        let plan = match self.subject(claim, &intent).await {
            Ok(plan) => plan,
            Err(outcome) => return outcome,
        };

        // One repository at a time; unrelated repositories stay free. No
        // database transaction is open across any of the Git work below.
        let _guard = self.locks.acquire(&plan.repository).await;
        // Under the lock the index is authoritative again. A discard that
        // another window finished while this one waited owns that removal and
        // its fact, so this one settles having removed nothing.
        let plan = match self.subject(claim, &intent).await {
            Ok(plan) => plan,
            Err(outcome) => return outcome,
        };
        if let Some(expected) = &intent.cleanup {
            let observation = match self.observe(&plan).await {
                Ok(observation) => observation,
                Err(outcome) => return self.settled(claim, outcome).await,
            };
            if let Some((code, detail)) = observation.conflict() {
                return self
                    .settled(claim, conflicted(code, detail, json!({ "conflict": code })))
                    .await;
            }
            if observation.checkout == CheckoutState::Present {
                let verified = cleanup::verify(&self.work_items, &self.git, &plan).await;
                if !matches!(verified, Ok(ref current) if current == expected) {
                    return self
                        .settled(
                            claim,
                            conflicted(
                                "worktree_cleanup_ineligible",
                                "This task worktree no longer satisfies every cleanup precondition.",
                                json!({ "cleanupEligible": false }),
                            ),
                        )
                        .await;
                }
            }
        }
        match self.release(&plan).await {
            Ok(removal) => self.settle_discarded(claim, &plan, removal).await,
            Err(outcome) => self.settled(claim, outcome).await,
        }
    }

    /// The plan to act on, or the settled outcome that ends this attempt. It
    /// is read twice — once to choose the repository lock, once under it —
    /// because everything it describes can change while the lock is waited on.
    async fn subject(
        &self,
        claim: &ClaimedOperation,
        intent: &DiscardIntent,
    ) -> Result<DiscardPlan, WorkspaceOperationOutcome> {
        match self.resubject(intent).await {
            Ok(Subject::Indexed(plan)) => Ok(plan),
            // The row is already gone, so this operation owns no remaining
            // effect and publishes nothing. Settling it applied — having
            // removed nothing — is the durable end of the story.
            Ok(Subject::Absent) => Err(self
                .settled(
                    claim,
                    WorkspaceOperationOutcome::Applied {
                        result: json!({
                            "removed": false,
                            "worktreeId": intent.worktree_id,
                            "taskId": intent.top_level_row_id,
                            "branch": intent.branch,
                        }),
                        evidence: json!({ "indexed": false }),
                    },
                )
                .await),
            Ok(Subject::Mismatched(outcome)) => Err(self.settled(claim, outcome).await),
            Err(error) => Err(self
                .settled(claim, retryable(error.code_str(), error.to_string()))
                .await),
        }
    }

    /// Complete whichever of the three removal steps Git still owes, and prove
    /// the result before anything is written.
    async fn release(&self, plan: &DiscardPlan) -> Result<Removal, WorkspaceOperationOutcome> {
        let observation = self.observe(plan).await?;
        if let Some((code, detail)) = observation.conflict() {
            return Err(conflicted(
                code,
                detail,
                json!({
                    "conflict": code,
                    "branch": plan.branch,
                    "checkoutName": plan.checkout_name,
                }),
            ));
        }

        let mut removal = Removal::default();
        match observation.checkout {
            CheckoutState::Present => {
                self.step(git_effects::remove(
                    self.git(),
                    &plan.repository,
                    &plan.checkout,
                ))
                .await?;
                removal.checkout_removed = true;
            }
            CheckoutState::Stale => {
                self.step(git_effects::prune(self.git(), &plan.repository))
                    .await?;
                removal.pruned = true;
            }
            CheckoutState::Absent => {}
            CheckoutState::Foreign { .. } => unreachable!("a conflict already returned above"),
        }
        if observation.branch == BranchState::Present {
            self.step(git_effects::delete_branch(
                self.git(),
                &plan.repository,
                &plan.branch,
            ))
            .await?;
            removal.branch_deleted = true;
        }

        // Git, not this function's own bookkeeping, decides whether the
        // checkout and the ref are actually released.
        let proved = self.observe(plan).await?;
        if !proved.settled() {
            return Err(WorkspaceOperationOutcome::Failed {
                code: "worktree_git_failed".to_owned(),
                message: "Git still holds the task checkout or its branch after the discard."
                    .to_owned(),
                // Whatever survives is still exactly this operation's own
                // subject, so the next attempt completes the missing step.
                retryable: true,
                cleanup_confirmed: true,
            });
        }
        Ok(removal)
    }

    async fn observe(
        &self,
        plan: &DiscardPlan,
    ) -> Result<DiscardObservation, WorkspaceOperationOutcome> {
        git_effects::observe(self.git(), &plan.repository, &plan.checkout, &plan.branch)
            .await
            .map_err(|error| retryable(error.code_str(), error.to_string()))
    }

    /// One Git step. A refusal is retryable: nothing was force-cleaned, and the
    /// next pass re-observes before it acts again.
    async fn step(
        &self,
        effect: impl std::future::Future<Output = Result<(), WorktreeDiscardError>>,
    ) -> Result<(), WorkspaceOperationOutcome> {
        effect
            .await
            .map_err(|error| retryable(error.code_str(), error.to_string()))
    }

    /// Settle a released checkout together with its row deletion and its fact.
    async fn settle_discarded(
        &self,
        claim: &ClaimedOperation,
        plan: &DiscardPlan,
        removal: Removal,
    ) -> WorkspaceOperationOutcome {
        let outcome = WorkspaceOperationOutcome::Applied {
            result: removal.result(plan),
            evidence: json!({
                "branch": plan.branch,
                "checkoutName": plan.checkout_name,
                "checkoutRemoved": removal.checkout_removed,
                "pruned": removal.pruned,
                "branchDeleted": removal.branch_deleted,
            }),
        };
        // The fact's project and owner come from the Work Item graph, which is
        // not what this settlement changes, so they are resolved before the
        // transaction opens.
        let scope =
            crate::worktree::facts::resolve_scope(&self.work_items, &plan.top_level_row_id).await;
        let events = self.events.clone();
        let written = self
            .journal
            .settle_with(
                &claim.operation_id,
                &claim.lease_owner,
                outcome.clone(),
                |transaction| {
                    let plan = plan.clone();
                    let events = events.clone();
                    let scope = scope.clone();
                    Box::pin(async move {
                        settlement::delete_row(transaction, &plan)
                            .await
                            .map_err(settlement_failure)?;
                        settlement::append_fact(events.as_ref(), transaction, &plan, scope.as_ref())
                            .await
                            .map_err(settlement_failure)
                    })
                },
            )
            .await;
        match written {
            Ok(_) => {
                if let Some(events) = &self.events {
                    // Waking subscribers happens only after the transaction
                    // committed, so nothing is published that did not commit.
                    events.wake_committed();
                }
                outcome
            }
            Err(error) => WorkspaceOperationOutcome::Failed {
                code: error.code_str().to_owned(),
                message: error.to_string(),
                // Git has already released the checkout; only the bookkeeping
                // failed, so the next attempt finds nothing left to remove and
                // deletes the row.
                retryable: true,
                cleanup_confirmed: true,
            },
        }
    }

    /// Settle an outcome that owns no model write of its own.
    async fn settled(
        &self,
        claim: &ClaimedOperation,
        outcome: WorkspaceOperationOutcome,
    ) -> WorkspaceOperationOutcome {
        match self
            .journal
            .settle(&claim.operation_id, &claim.lease_owner, outcome.clone())
            .await
        {
            Ok(_) => outcome,
            Err(error) => WorkspaceOperationOutcome::Failed {
                code: error.code_str().to_owned(),
                message: error.to_string(),
                retryable: true,
                cleanup_confirmed: true,
            },
        }
    }
}

/// The executor the journal's reconciler drives. It performs exactly what a
/// user-initiated discard performs.
#[async_trait]
impl WorkspaceOperationExecutor for DiscardExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.perform(&claim).await
    }
}

fn conflicted(code: &str, message: &str, evidence: serde_json::Value) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: code.to_owned(),
        message: message.to_owned(),
        evidence,
    }
}

fn retryable(code: &str, message: impl Into<String>) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.into(),
        retryable: true,
        // A discard leaves no staged artifact behind: whatever it did not
        // finish removing is still its own subject, which the next pass
        // observes before it acts.
        cleanup_confirmed: true,
    }
}

fn settlement_failure(
    error: WorktreeDiscardError,
) -> crate::workspace::operations::WorkspaceOperationError {
    crate::workspace::operations::WorkspaceOperationError::settlement(error.to_string())
}
