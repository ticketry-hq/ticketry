//! The one idempotent performer of a prepared integration.
//!
//! Landing a checkout is five external effects in a fixed order — merge the
//! recorded base into the isolated tree, advance the base to the merged tip,
//! remove the checkout, delete the task branch, then delete the row with its
//! fact — and no transaction spans them. A process can stop between any two.
//!
//! What makes that safe to repeat is that every step is *recognisable* rather
//! than remembered:
//!
//! * **Ancestry is the proof.** "The base is contained in the branch" is the
//!   merge; "the branch is contained in the base" is the ref advance. Neither
//!   can be faked by deleting a directory, and a step whose proof already
//!   holds is skipped rather than performed a second time — so no second merge
//!   commit is ever created.
//! * **The one thing ancestry cannot survive is its own subject.** Once the
//!   task branch is deleted, nothing in the repository remembers what it
//!   contained, so the landed commit is checkpointed in the operation *before*
//!   the branch is deleted. Recovery after that boundary proves the recorded
//!   base still contains that exact commit; it never concludes success from a
//!   missing branch, a missing checkout, or a missing row.
//! * **Nothing foreign is touched.** A checkout path registered to another
//!   branch, a base ref that no longer exists, and a repository the module no
//!   longer points at are all durable conflicts. The base only ever moves
//!   forward, by fast-forward or by an exact move onto a commit that already
//!   contains it.
//!
//! The executor settles the operation itself, because the row and the fact
//! must commit in that same transaction. A caller that settles the same
//! outcome again — as the reconciler does — is a durable no-op by design.

use async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use crate::runs_persistence::StatusEventRepository;
use crate::settings_persistence::ProfileStore;
use crate::workspace_operations::{
    ClaimedOperation, WorkspaceOperationExecutor, WorkspaceOperationJournal,
    WorkspaceOperationOutcome,
};
use crate::worktree_facts::{WorktreeChange, WorktreeFactScope};
use crate::worktree_status::{GitPort, RepositoryLocks};

use super::error::WorktreeIntegrateError;
use super::git_evidence::{self, MergeOutcome, Registration};
use super::identity::IntegrateIntent;
use super::plan::{self, IntegrationPlan, PlanResolution};
use super::settlement;

/// What the repository ended up proving about this landing.
enum Landing {
    /// The base contains the branch, the checkout is gone, and the branch is
    /// gone. Only the row and its fact are left.
    Landed { commit: String, base_tip: String },
    /// The merge stopped inside the isolated checkout. The tree keeps the
    /// half-finished merge and the primary checkout was never touched.
    Stopped { detail: String },
}

#[derive(Clone)]
pub(crate) struct IntegrateExecutor {
    work_items: DatabaseConnection,
    profiles: ProfileStore,
    journal: WorkspaceOperationJournal,
    events: Option<StatusEventRepository>,
    locks: RepositoryLocks,
    git: GitPort,
}

impl IntegrateExecutor {
    pub(crate) fn new(
        work_items: DatabaseConnection,
        profiles: ProfileStore,
        journal: WorkspaceOperationJournal,
        events: Option<StatusEventRepository>,
        locks: RepositoryLocks,
    ) -> Self {
        Self {
            work_items,
            profiles,
            journal,
            events,
            locks,
            git: GitPort::new(),
        }
    }

    pub(crate) fn work_items(&self) -> &DatabaseConnection {
        &self.work_items
    }

    pub(crate) fn profiles(&self) -> &ProfileStore {
        &self.profiles
    }

    pub(crate) fn git(&self) -> &GitPort {
        &self.git
    }

    pub(crate) fn journal(&self) -> &WorkspaceOperationJournal {
        &self.journal
    }

    /// Re-derive the landing a journalled intent describes, and compare it with
    /// what the intent recorded. Nothing is taken from the journal itself: the
    /// owner, the module's repository, the checkout, the branch, and the base
    /// are all read from current trusted state.
    pub(crate) async fn replan(
        &self,
        intent: &IntegrateIntent,
    ) -> Result<Result<IntegrationPlan, WorkspaceOperationOutcome>, WorktreeIntegrateError> {
        let resolved = plan::derive(
            &self.work_items,
            &self.profiles,
            &self.git,
            &intent.top_level_row_id,
        )
        .await?;
        Ok(match resolved {
            PlanResolution::Plan(plan) if intent.matches(&plan) => Ok(*plan),
            PlanResolution::Plan(plan) => Err(conflicted(
                "worktree_row_mismatch",
                "This Work Item now indexes a different checkout, branch, or base than the prepared integration intended.",
                json!({
                    "intendedBranch": intent.branch,
                    "intendedBaseRef": intent.base_ref,
                    "indexedBranch": plan.branch,
                    "indexedBaseRef": plan.base_ref,
                }),
            )),
            // The row is gone while this operation is still open. Only a
            // settlement removes a row, and this operation never settled, so
            // something else did — which is a conflict, never a success.
            PlanResolution::NoWorktree => Err(conflicted(
                "worktree_row_absent",
                "The checkout this integration was prepared for is no longer indexed.",
                json!({ "indexed": false }),
            )),
            PlanResolution::NoRepository(reason) => Err(retryable(
                "worktree_repository_unavailable",
                format!("The repository for this Work Item is unavailable: {reason}."),
            )),
            PlanResolution::Mismatched { code, detail } => {
                Err(conflicted(code, &detail, json!({ "mismatch": code })))
            }
        })
    }

    /// Perform one claimed integration, from the repository lock through
    /// settlement.
    pub(crate) async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
        let Some(intent) = IntegrateIntent::decode(&claim.payload) else {
            return WorkspaceOperationOutcome::Failed {
                code: "worktree_intent_undecodable".to_owned(),
                message: "The prepared integration intent cannot be decoded by this build."
                    .to_owned(),
                retryable: false,
                cleanup_confirmed: true,
            };
        };
        let plan = match self.replan(&intent).await {
            Ok(Ok(plan)) => plan,
            Ok(Err(outcome)) => return self.settled(claim, outcome).await,
            Err(error) => {
                return self
                    .settled(claim, retryable(error.code_str(), error.to_string()))
                    .await
            }
        };
        // One repository at a time; unrelated repositories stay free. No
        // database transaction is open across any of the Git work below.
        let _guard = self.locks.acquire(&plan.repository).await;
        match self.converge(claim, &plan).await {
            Ok(landing) => self.settle_landing(claim, &plan, landing).await,
            Err(outcome) => self.settled(claim, outcome).await,
        }
    }

    /// Bring the repository to the landed state, or explain why it cannot be.
    async fn converge(
        &self,
        claim: &ClaimedOperation,
        plan: &IntegrationPlan,
    ) -> Result<Landing, WorkspaceOperationOutcome> {
        if plan.ephemeral {
            return Err(refused(
                "worktree_ephemeral",
                "An ephemeral checkout is discard-only and is never landed.",
            ));
        }
        let base_tip = self
            .branch_tip(plan, &plan.base_ref)
            .await?
            .ok_or_else(|| {
                conflicted(
                    "worktree_base_ref_missing",
                    "The base this checkout was cut from is not a branch of this repository, so there is no ref to advance.",
                    json!({ "baseRef": plan.base_ref }),
                )
            })?;
        match self.branch_tip(plan, &plan.branch).await? {
            Some(tip) => self.land(claim, plan, tip, base_tip).await,
            None => self.land_from_evidence(claim, plan, base_tip).await,
        }
    }

    /// The ordinary path: the task branch still exists, so every remaining step
    /// is decided by what its history already contains.
    async fn land(
        &self,
        claim: &ClaimedOperation,
        plan: &IntegrationPlan,
        tip: String,
        base_tip: String,
    ) -> Result<Landing, WorkspaceOperationOutcome> {
        let mut checkout = self.checkout_state(plan).await?;
        if checkout.live && self.dirty(&plan.checkout).await? {
            // Uncommitted work — including an unresolved merge from an earlier
            // attempt — is never landed and never discarded.
            return Err(refused(
                "worktree_dirty",
                "The task checkout has uncommitted changes; commit them and complete the Work Item again.",
            ));
        }

        // 1. Merge, unless the branch already contains the base.
        let mut tip = tip;
        if !self.contains(plan, &base_tip, &plan.branch).await? {
            if !checkout.live {
                return Err(conflicted(
                    "worktree_checkout_missing",
                    "The task checkout is gone, so the recorded base cannot be merged into it.",
                    json!({ "branch": plan.branch }),
                ));
            }
            match self.merge(plan).await? {
                MergeOutcome::Merged { tip: merged } => tip = merged,
                MergeOutcome::Stopped { detail } => return Ok(Landing::Stopped { detail }),
                MergeOutcome::Refused { detail } => {
                    return Err(conflicted(
                        "worktree_merge_failed",
                        "Git refused to merge the recorded base into the task checkout.",
                        json!({ "detail": detail }),
                    ))
                }
            }
        }
        // The landed commit is recorded before anything that could destroy the
        // evidence of it, so a restart after the branch is gone can still prove
        // what was supposed to have landed.
        self.checkpoint(
            claim,
            json!({ "merged": true, "landedCommit": tip, "baseAtMerge": base_tip }),
        )
        .await?;

        // 2. Advance the recorded base, unless it already contains the branch.
        let base_checked_out = self.base_is_checked_out(plan).await?;
        let mut base_tip = base_tip;
        if !self.contains(plan, &tip, &plan.base_ref).await? {
            git_evidence::advance_base(
                self.git(),
                &plan.repository,
                &plan.base_ref,
                &plan.branch,
                base_checked_out,
            )
            .await
            .map_err(|error| retryable(error.code_str(), error.to_string()))?;
            if !self.contains(plan, &tip, &plan.base_ref).await? {
                return Err(retryable(
                    "worktree_base_not_advanced",
                    "Git reported the base advanced, but it does not contain the landed commit.",
                ));
            }
            base_tip = self
                .branch_tip(plan, &plan.base_ref)
                .await?
                .unwrap_or(base_tip);
            self.checkpoint(claim, json!({ "baseAdvancedTo": base_tip }))
                .await?;
        }

        // 3. Remove the checkout, now that the base holds everything it did.
        if checkout.live {
            git_evidence::remove_checkout(self.git(), &plan.repository, &plan.checkout)
                .await
                .map_err(|error| retryable(error.code_str(), error.to_string()))?;
            self.checkpoint(claim, json!({ "checkoutRemoved": true }))
                .await?;
            checkout = self.checkout_state(plan).await?;
        }
        if checkout.occupied {
            return Err(conflicted(
                "worktree_path_taken",
                "Something still occupies the checkout path Git no longer registers.",
                json!({ "checkoutName": plan.checkout_name }),
            ));
        }

        // 4. Delete the merged task branch.
        git_evidence::delete_branch(
            self.git(),
            &plan.repository,
            &plan.branch,
            base_checked_out,
        )
        .await
        .map_err(|error| retryable(error.code_str(), error.to_string()))?;
        self.checkpoint(claim, json!({ "branchDeleted": true }))
            .await?;

        Ok(Landing::Landed {
            commit: tip,
            base_tip,
        })
    }

    /// The recovery path: the task branch is already gone, so the repository
    /// alone cannot say what it held. The landed commit checkpointed before the
    /// deletion is the only admissible evidence, and it is believed only if the
    /// recorded base still contains it.
    async fn land_from_evidence(
        &self,
        claim: &ClaimedOperation,
        plan: &IntegrationPlan,
        base_tip: String,
    ) -> Result<Landing, WorkspaceOperationOutcome> {
        let landed = self
            .checkpointed(claim, "landedCommit")
            .await
            .ok_or_else(|| {
                conflicted(
                    "worktree_branch_absent",
                    "The task branch is gone and nothing proves what it contained.",
                    json!({ "branch": plan.branch }),
                )
            })?;
        if !self.contains(plan, &landed, &plan.base_ref).await? {
            return Err(conflicted(
                "worktree_branch_absent",
                "The task branch is gone and the recorded base does not contain what it landed.",
                json!({ "branch": plan.branch, "landedCommit": landed }),
            ));
        }
        let checkout = self.checkout_state(plan).await?;
        if checkout.live {
            git_evidence::remove_checkout(self.git(), &plan.repository, &plan.checkout)
                .await
                .map_err(|error| retryable(error.code_str(), error.to_string()))?;
            self.checkpoint(claim, json!({ "checkoutRemoved": true }))
                .await?;
        } else if checkout.occupied {
            return Err(conflicted(
                "worktree_path_taken",
                "Something still occupies the checkout path Git no longer registers.",
                json!({ "checkoutName": plan.checkout_name }),
            ));
        }
        Ok(Landing::Landed {
            commit: landed,
            base_tip,
        })
    }

    /// Settle a proved landing, or a merge that stopped, together with the row
    /// it owns and the fact it publishes.
    async fn settle_landing(
        &self,
        claim: &ClaimedOperation,
        plan: &IntegrationPlan,
        landing: Landing,
    ) -> WorkspaceOperationOutcome {
        // Resolved before the settlement opens: the Work Item graph is not what
        // the settlement changes, and the row it addresses is about to go.
        let scope = crate::worktree_facts::resolve_scope(&self.work_items, &plan.top_level_row_id)
            .await;
        let (outcome, change) = match &landing {
            Landing::Landed { commit, base_tip } => (
                WorkspaceOperationOutcome::Applied {
                    result: json!({
                        "worktreeId": plan.worktree_id,
                        "taskId": plan.top_level_row_id,
                        "branch": plan.branch,
                        "baseRef": plan.base_ref,
                        "landedCommit": commit,
                        "integrated": true,
                    }),
                    evidence: json!({
                        "landedCommit": commit,
                        "baseTip": base_tip,
                        "branchDeleted": true,
                        "checkoutRemoved": true,
                    }),
                },
                WorktreeChange::Integrated,
            ),
            Landing::Stopped { detail } => (
                WorkspaceOperationOutcome::Conflicted {
                    code: "worktree_merge_conflict".to_owned(),
                    message:
                        "The recorded base could not be merged cleanly; resolve it in the task checkout and complete the Work Item again."
                            .to_owned(),
                    evidence: json!({ "conflict": "worktree_merge_conflict", "detail": detail }),
                },
                WorktreeChange::Conflicted,
            ),
        };
        self.settle_with_model(claim, plan, scope, outcome, change)
            .await
    }

    async fn settle_with_model(
        &self,
        claim: &ClaimedOperation,
        plan: &IntegrationPlan,
        scope: Option<WorktreeFactScope>,
        outcome: WorkspaceOperationOutcome,
        change: WorktreeChange,
    ) -> WorkspaceOperationOutcome {
        let events = self.events.clone();
        let written = self
            .journal
            .settle_with(
                &claim.operation_id,
                &claim.lease_owner,
                outcome.clone(),
                |transaction| {
                    let plan = plan.clone();
                    let scope = scope.clone();
                    let events = events.clone();
                    Box::pin(async move {
                        if change.removes() {
                            settlement::delete_row(transaction, &plan)
                                .await
                                .map_err(settlement_failure)?;
                        } else {
                            settlement::mark_conflict(transaction, &plan)
                                .await
                                .map_err(settlement_failure)?;
                        }
                        settlement::append_fact(
                            events.as_ref(),
                            transaction,
                            &plan,
                            scope.as_ref(),
                            change,
                        )
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
                // Git already proved the landing; only its bookkeeping failed,
                // so the next attempt recognises the finished steps and
                // completes the settlement rather than repeating them.
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

    // -- Narrow wrappers, so the steps above read as decisions ---------------

    async fn checkout_state(
        &self,
        plan: &IntegrationPlan,
    ) -> Result<CheckoutState, WorkspaceOperationOutcome> {
        let registration =
            git_evidence::registration(self.git(), &plan.repository, &plan.checkout, &plan.branch)
                .await
                .map_err(git_failure)?;
        if let Registration::Foreign { branch } = &registration {
            return Err(conflicted(
                "worktree_checkout_foreign",
                "The recorded checkout path is registered to another branch of this repository.",
                json!({ "registeredBranch": branch, "expectedBranch": plan.branch }),
            ));
        }
        let present = plan.checkout.is_dir();
        if matches!(registration, Registration::Matching) && !present {
            // Git still holds an administrative record for a directory that is
            // gone. Pruning drops only records Git itself considers stale.
            git_evidence::prune(self.git(), &plan.repository)
                .await
                .map_err(git_failure)?;
            return Ok(CheckoutState {
                live: false,
                occupied: false,
            });
        }
        Ok(CheckoutState {
            live: matches!(registration, Registration::Matching) && present,
            occupied: matches!(registration, Registration::Absent) && present,
        })
    }

    async fn dirty(&self, checkout: &std::path::Path) -> Result<bool, WorkspaceOperationOutcome> {
        git_evidence::dirty(self.git(), checkout)
            .await
            .map_err(git_failure)
    }

    async fn merge(
        &self,
        plan: &IntegrationPlan,
    ) -> Result<MergeOutcome, WorkspaceOperationOutcome> {
        git_evidence::merge_base(self.git(), &plan.checkout, &plan.base_ref)
            .await
            .map_err(git_failure)
    }

    async fn branch_tip(
        &self,
        plan: &IntegrationPlan,
        branch: &str,
    ) -> Result<Option<String>, WorkspaceOperationOutcome> {
        git_evidence::branch_tip(self.git(), &plan.repository, branch)
            .await
            .map_err(git_failure)
    }

    async fn contains(
        &self,
        plan: &IntegrationPlan,
        ancestor: &str,
        descendant: &str,
    ) -> Result<bool, WorkspaceOperationOutcome> {
        git_evidence::contains(self.git(), &plan.repository, ancestor, descendant)
            .await
            .map_err(git_failure)
    }

    async fn base_is_checked_out(
        &self,
        plan: &IntegrationPlan,
    ) -> Result<bool, WorkspaceOperationOutcome> {
        Ok(
            git_evidence::head_branch(self.git(), &plan.repository)
                .await
                .map_err(git_failure)?
                .as_deref()
                == Some(plan.base_ref.as_str()),
        )
    }

    /// Record one boundary observation under this attempt's lease. A
    /// checkpoint that cannot be written stops the attempt, because the steps
    /// after it are the ones that destroy the evidence it holds.
    async fn checkpoint(
        &self,
        claim: &ClaimedOperation,
        observation: Value,
    ) -> Result<(), WorkspaceOperationOutcome> {
        self.journal
            .record_checkpoint(&claim.operation_id, &claim.lease_owner, observation)
            .await
            .map(|_| ())
            .map_err(|error| {
                retryable(
                    "worktree_checkpoint_unwritable",
                    format!("The integration's Git evidence could not be recorded: {error}"),
                )
            })
    }

    /// One durable checkpoint value, as a later attempt reads it back.
    pub(crate) async fn checkpointed(&self, claim: &ClaimedOperation, key: &str) -> Option<String> {
        self.journal
            .find(&claim.operation_id)
            .await
            .ok()
            .flatten()?
            .checkpoint()
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
    }
}

/// The executor the journal's reconciler drives. It performs exactly what a
/// delivered completion performs.
#[async_trait]
impl WorkspaceOperationExecutor for IntegrateExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.perform(&claim).await
    }
}

/// What the repository shows about the checkout this landing owns.
struct CheckoutState {
    /// Git registers this exact path on this exact branch, and it is there.
    live: bool,
    /// Something is at the path that Git does not register as this checkout.
    occupied: bool,
}

fn conflicted(code: &str, message: &str, evidence: Value) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: code.to_owned(),
        message: message.to_owned(),
        evidence,
    }
}

/// A refusal that protects work: nothing external was attempted, and repeating
/// it under this identity would only refuse again. A later completion of the
/// same Work Item is a new occurrence and therefore a new attempt.
fn refused(code: &str, message: &str) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.to_owned(),
        retryable: false,
        cleanup_confirmed: true,
    }
}

fn retryable(code: &str, message: impl Into<String>) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.into(),
        retryable: true,
        // Every step is re-derived from ancestry on the next attempt, so an
        // interrupted one leaves nothing that has to be cleaned up first.
        cleanup_confirmed: true,
    }
}

fn git_failure(error: WorktreeIntegrateError) -> WorkspaceOperationOutcome {
    retryable(error.code_str(), error.to_string())
}

fn settlement_failure(
    error: WorktreeIntegrateError,
) -> crate::workspace_operations::WorkspaceOperationError {
    crate::workspace_operations::WorkspaceOperationError::settlement(error.to_string())
}
