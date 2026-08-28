//! The one idempotent performer of a prepared creation.
//!
//! Both paths that can create a checkout — a user asking through GraphQL and
//! startup reconciliation draining the journal — run exactly this code under
//! exactly one claim, so there is a single place where the repository lock is
//! held, Git is inspected, the checkout is cut, and the row, the fact, and the
//! operation settle together.
//!
//! Three rules make repetition safe:
//!
//! * **Nothing is derived from the journal.** The intent carries relative
//!   identities only; the owning Work Item, the module's configured folder,
//!   the repository, and the absolute checkout path are re-resolved from
//!   current trusted state and then *compared* with the intent. A module now
//!   pointing at a different repository is a conflict, not a second checkout.
//! * **Git is asked before it is told.** An exact matching checkout is
//!   adopted, a clear repository is cut from its committed HEAD, and anything
//!   else — an occupied path, a branch checked out elsewhere, a pre-existing
//!   branch — becomes a durable conflict that is never force-removed.
//! * **The database only ever follows Git.** The row and its fact are written
//!   inside the operation's settlement transaction, after Git has proved the
//!   checkout and the ref.
//!
//! The executor settles the operation itself, because the row and the fact
//! must commit in that same transaction. A caller that settles the same
//! outcome again — as the reconciler does — is a durable no-op by design.

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde_json::json;

use crate::entities::worktrees::worktree;
use crate::runs_persistence::StatusEventRepository;
use crate::settings_persistence::ProfileStore;
use crate::workspace::operations::{
    ClaimedOperation, WorkspaceOperationExecutor, WorkspaceOperationJournal,
    WorkspaceOperationOutcome,
};
use crate::worktree::status::registry::same_path;
use crate::worktree::status::{
    owner, repository as repository_resolution, GitPort, RepositoryLocks,
};

use super::error::WorktreeCreateError;
use super::git_effects::{self, CheckoutObservation};
use super::identity::CreateIntent;
use super::plan::{self, CreatePlan};
use super::settlement::{self, SettledWorktree};

/// Everything a creation needs that is not derived per request.
#[derive(Clone)]
pub(crate) struct CreateExecutor {
    work_items: DatabaseConnection,
    profiles: ProfileStore,
    journal: WorkspaceOperationJournal,
    events: Option<StatusEventRepository>,
    locks: RepositoryLocks,
    git: GitPort,
}

impl CreateExecutor {
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

    /// Re-derive the plan a journalled intent describes. A repository that can
    /// no longer be resolved, or one that no longer matches the intent, is
    /// reported rather than acted on.
    pub(crate) async fn replan(
        &self,
        intent: &CreateIntent,
    ) -> Result<Result<CreatePlan, WorkspaceOperationOutcome>, WorktreeCreateError> {
        let owner = owner::resolve(&self.work_items, &intent.top_level_row_id).await?;
        let repository = match repository_resolution::resolve(
            &self.profiles,
            &self.git,
            owner.module_id.as_deref(),
        )
        .await?
        {
            repository_resolution::RepositoryResolution::Repository(repository) => repository,
            repository_resolution::RepositoryResolution::NoRepository(reason) => {
                return Ok(Err(retryable(
                    "worktree_repository_unavailable",
                    format!("The repository for this Work Item is unavailable: {reason}."),
                )))
            }
        };
        let plan = plan::for_owner(&self.work_items, &self.profiles, owner, repository).await?;
        if !intent.matches(&plan) {
            return Ok(Err(conflicted(
                "worktree_repository_mismatch",
                "The Work Item now resolves to a different repository, branch, or checkout than the prepared operation intended.",
                json!({
                    "intendedBranch": intent.branch,
                    "intendedCheckoutName": intent.checkout_name,
                    "derivedBranch": plan.branch,
                    "derivedCheckoutName": plan.checkout_name,
                    "repositoryMatches": intent.repository_digest == plan.repository_digest,
                }),
            )));
        }
        Ok(Ok(plan))
    }

    /// Perform one claimed creation, from the repository lock through
    /// settlement.
    pub(crate) async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
        let Some(intent) = CreateIntent::decode(&claim.payload) else {
            return WorkspaceOperationOutcome::Failed {
                code: "worktree_intent_undecodable".to_owned(),
                message: "The prepared worktree intent cannot be decoded by this build.".to_owned(),
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
        let outcome = self.converge(&plan).await;
        match outcome {
            Ok(Converged::Existing(outcome)) => self.settled(claim, outcome).await,
            Ok(Converged::Proved(settled)) => self.settle_created(claim, &plan, settled).await,
            Err(outcome) => self.settled(claim, outcome).await,
        }
    }

    /// Bring the repository and the index to the intended state, or explain
    /// why they cannot be.
    async fn converge(&self, plan: &CreatePlan) -> Result<Converged, WorkspaceOperationOutcome> {
        if let Some(row) = self
            .existing_row(plan)
            .await
            .map_err(|error| retryable(error.code_str(), error.to_string()))?
        {
            return Ok(Converged::Existing(row));
        }
        let observation =
            git_effects::observe(self.git(), &plan.repository, &plan.checkout, &plan.branch)
                .await
                .map_err(|error| retryable(error.code_str(), error.to_string()))?;

        match observation {
            // A checkout this operation already cut, whose row never
            // committed. It is adopted rather than created a second time.
            CheckoutObservation::Matching { head_commit } => {
                Ok(Converged::Proved(SettledWorktree {
                    worktree_id: uuid::Uuid::new_v4().simple().to_string(),
                    base_ref: self.base_ref(plan, &head_commit).await,
                    base_commit: head_commit,
                    adopted: true,
                }))
            }
            CheckoutObservation::Conflicting { code, detail } => Err(conflicted(
                &code,
                &detail,
                json!({ "conflict": code, "branch": plan.branch, "checkoutName": plan.checkout_name }),
            )),
            CheckoutObservation::Clear => self.cut(plan).await.map(Converged::Proved),
        }
    }

    /// Cut the branch from the repository's committed HEAD and prove the
    /// result before anything is written.
    async fn cut(&self, plan: &CreatePlan) -> Result<SettledWorktree, WorkspaceOperationOutcome> {
        let head = git_effects::head(self.git(), &plan.repository)
            .await
            .map_err(|error| retryable(error.code_str(), error.to_string()))?;
        if let Err(error) = git_effects::create(
            self.git(),
            &plan.repository,
            &plan.checkout,
            &plan.branch,
            &head.commit,
        )
        .await
        {
            return Err(self.failed_creation(plan, error).await);
        }
        let head_commit =
            git_effects::verify(self.git(), &plan.repository, &plan.checkout, &plan.branch)
                .await
                .map_err(|error| retryable(error.code_str(), error.to_string()))?;
        Ok(SettledWorktree {
            worktree_id: uuid::Uuid::new_v4().simple().to_string(),
            base_ref: head.base_ref,
            base_commit: head_commit,
            adopted: false,
        })
    }

    /// A refused `git worktree add`. Whether the same intent may be attempted
    /// again depends on what survives: only a repository that shows no trace
    /// of the intended checkout is provably clean.
    async fn failed_creation(
        &self,
        plan: &CreatePlan,
        error: WorktreeCreateError,
    ) -> WorkspaceOperationOutcome {
        let remnant =
            git_effects::observe(self.git(), &plan.repository, &plan.checkout, &plan.branch).await;
        let cleanup_confirmed = matches!(remnant, Ok(CheckoutObservation::Clear));
        WorkspaceOperationOutcome::Failed {
            code: "worktree_git_failed".to_owned(),
            message: error.to_string(),
            retryable: cleanup_confirmed,
            cleanup_confirmed,
        }
    }

    /// A row already indexes this Work Item's checkout. The same checkout is
    /// the durable result; a different one is a conflict, never a replacement.
    async fn existing_row(
        &self,
        plan: &CreatePlan,
    ) -> Result<Option<WorkspaceOperationOutcome>, WorktreeCreateError> {
        let Some(row) = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(plan.owner.top_level_row_id()))
            .one(&self.work_items)
            .await?
        else {
            return Ok(None);
        };
        if row.branch != plan.branch || !same_path(&row.path, &plan.checkout) {
            return Ok(Some(conflicted(
                "worktree_row_mismatch",
                "This Work Item already indexes a different checkout.",
                json!({ "indexedBranch": row.branch, "intendedBranch": plan.branch }),
            )));
        }
        let settled = SettledWorktree {
            worktree_id: row.id.clone(),
            base_ref: row.base_branch.clone(),
            base_commit: row.base_commit.clone(),
            adopted: true,
        };
        Ok(Some(WorkspaceOperationOutcome::Applied {
            result: settled.result(plan),
            evidence: json!({ "adopted": true, "indexed": true, "branch": row.branch }),
        }))
    }

    /// The base an adopted checkout integrates back into. The repository's
    /// current named HEAD is the same answer creation would have recorded; a
    /// detached repository falls back to the proved commit.
    async fn base_ref(&self, plan: &CreatePlan, head_commit: &str) -> String {
        match git_effects::head(self.git(), &plan.repository).await {
            Ok(head) => head.base_ref,
            Err(_) => head_commit.to_owned(),
        }
    }

    /// Settle a proved checkout together with its row and its durable fact.
    async fn settle_created(
        &self,
        claim: &ClaimedOperation,
        plan: &CreatePlan,
        settled: SettledWorktree,
    ) -> WorkspaceOperationOutcome {
        let outcome = WorkspaceOperationOutcome::Applied {
            result: settled.result(plan),
            evidence: json!({
                "adopted": settled.adopted,
                "branch": plan.branch,
                "baseRef": settled.base_ref,
                "baseCommit": settled.base_commit,
                "checkoutName": plan.checkout_name,
            }),
        };
        let events = self.events.clone();
        let settlement_outcome = outcome.clone();
        // Resolved before the transaction opens: the fact's project and owner
        // come from the Work Item graph, and reading them is not settlement
        // work that should hold the settlement transaction open.
        let scope =
            crate::worktree::facts::resolve_scope(self.work_items(), &plan.owner.top_level_task_id)
                .await;
        let written = self
            .journal
            .settle_with(
                &claim.operation_id,
                &claim.lease_owner,
                settlement_outcome,
                |transaction| {
                    let plan = plan.clone();
                    let settled = settled.clone();
                    let events = events.clone();
                    let scope = scope.clone();
                    Box::pin(async move {
                        settlement::insert_row(transaction, &plan, &settled)
                            .await
                            .map_err(settlement_failure)?;
                        settlement::append_fact(
                            events.as_ref(),
                            transaction,
                            scope.as_ref(),
                            &plan,
                            &settled,
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
                // The checkout is real and proved; only its bookkeeping
                // failed, so the next attempt adopts rather than recreates.
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
/// user-initiated creation performs.
#[async_trait]
impl WorkspaceOperationExecutor for CreateExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.perform(&claim).await
    }
}

enum Converged {
    /// The world already holds the intended result; nothing was written.
    Existing(WorkspaceOperationOutcome),
    /// Git proved the exact checkout, which now needs its row and its fact.
    Proved(SettledWorktree),
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
        // Nothing external was attempted on this path, so there is nothing
        // that could survive it.
        cleanup_confirmed: true,
    }
}

fn settlement_failure(
    error: WorktreeCreateError,
) -> crate::workspace::operations::WorkspaceOperationError {
    crate::workspace::operations::WorkspaceOperationError::settlement(error.to_string())
}
