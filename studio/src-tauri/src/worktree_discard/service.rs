//! The one place a worktree discard is answered.
//!
//! Studio submits a Work Item identity and an operation identity — after its
//! own explicit confirmation — and receives whether a checkout was removed
//! plus the authoritative status of the Work Item afterwards. Everything
//! between those two facts is derived here: the owning Work Item, the exact
//! indexed row, the repository, the checkout path, the branch, the durable
//! operation, the Git effects, the row deletion, and the published fact.
//!
//! Repetition is ordinary and deliberately narrow:
//!
//! * A Work Item with no checkout is answered `removed: false`, and nothing is
//!   journalled — there is no effect to recover.
//! * An operation identity that already applied replays its durable result, so
//!   a lost response cannot become a second discard, and cannot become a
//!   confusing "nothing to remove" either.
//! * Two concurrent discards of one checkout serialize on the repository and
//!   converge on one removal, one row deletion, and one fact.
//! * Reusing an operation identity for *different* intent is refused, because
//!   rebinding a durable identity would make recovery a guess about what to
//!   delete.

use std::sync::Arc;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::worktrees::worktree;
use crate::runs_persistence::StatusEventRepository;
use crate::settings_persistence::ProfileStore;
use crate::workspace_operations::{
    WorkspaceOperationJournal, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
};
use crate::worktree_status::{owner, RepositoryLocks, WorktreeStatusService, WorktreeStatusView};

use super::error::{WorktreeDiscardError, WorktreeDiscardErrorCode};
use super::executor::DiscardExecutor;
use super::identity;
use super::plan::DiscardPlan;
use super::probe::DiscardProbe;
use super::view::WorktreeDiscardResult;

/// A discard claim is short. The Git work it covers is one removal, one prune,
/// and one branch deletion, and a worker that dies mid-effect must become
/// eligible again quickly.
const DISCARD_LEASE_SECONDS: i64 = 120;

#[derive(Clone)]
pub struct WorktreeDiscardService {
    executor: DiscardExecutor,
    status: WorktreeStatusService,
}

impl WorktreeDiscardService {
    /// Compose the discard seam over the locks the rest of the worktree
    /// capability already serializes on, so a status read, a creation, and a
    /// discard can never observe one repository at the same moment.
    pub fn new(
        work_items: DatabaseConnection,
        profiles: ProfileStore,
        journal: WorkspaceOperationJournal,
        events: Option<StatusEventRepository>,
        locks: RepositoryLocks,
    ) -> Self {
        Self {
            executor: DiscardExecutor::new(work_items.clone(), journal, events, locks.clone()),
            status: WorktreeStatusService::with_locks(work_items, profiles, locks),
        }
    }

    /// The reconciler that drains abandoned discards at startup. It probes
    /// external state before it acts and executes through the very same
    /// executor a confirmed discard uses.
    pub fn reconciler(&self) -> WorkspaceOperationReconciler {
        self.executor.journal().reconcile_with(
            Arc::new(DiscardProbe::new(self.executor.clone())),
            Arc::new(self.executor.clone()),
        )
    }

    /// Discard the one checkout this Work Item's top-level owner has.
    pub async fn discard(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<WorktreeDiscardResult, WorktreeDiscardError> {
        // Ownership is derived, never submitted: a child discards the parent's
        // shared checkout, and a module is refused before anything else runs.
        let owner = owner::resolve(self.executor.work_items(), task_id).await?;

        let Some(row) = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.executor.work_items())
            .await?
        else {
            return self.nothing_indexed(task_id, operation_id).await;
        };
        let plan = DiscardPlan::for_row(&row);

        let prepared = self
            .executor
            .journal()
            .prepare(identity::intent(operation_id, &plan))
            .await?;
        if prepared.reused {
            if let Some(answer) = self.replayed(task_id, &prepared.operation).await? {
                return Ok(answer);
            }
        }

        let claim = self
            .executor
            .journal()
            .claim(operation_id, &lease_owner(), DISCARD_LEASE_SECONDS)
            .await?;
        match self.executor.perform(&claim).await {
            WorkspaceOperationOutcome::Applied { result, .. } => Ok(WorktreeDiscardResult::settled(
                &result,
                self.status(task_id).await?,
            )),
            WorkspaceOperationOutcome::Conflicted { code, message, .. } => {
                Err(WorktreeDiscardError::external_conflict(&code, &message))
            }
            WorkspaceOperationOutcome::Failed { code, message, .. } => Err(failure(&code, &message)),
        }
    }

    /// No row indexes this Work Item. Either this exact operation already
    /// removed it — in which case its durable result is the answer — or there
    /// was never anything to remove.
    async fn nothing_indexed(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<WorktreeDiscardResult, WorktreeDiscardError> {
        let status = self.status(task_id).await?;
        let durable = self.executor.journal().find(operation_id).await?;
        match durable.as_ref().and_then(|operation| {
            (operation.state == "applied")
                .then(|| operation.result())
                .flatten()
        }) {
            // Only this Work Item's own durable discard replays here: an
            // identity that settled some other subject is not this answer.
            Some(result)
                if result["taskId"].as_str() == Some(status.top_level_task_id.as_str())
                    || result["taskId"].as_str()
                        == Some(compact(&status.top_level_task_id).as_str()) =>
            {
                Ok(WorktreeDiscardResult::settled(&result, status))
            }
            _ => Ok(WorktreeDiscardResult::absent(status)),
        }
    }

    /// The durable answer for an operation identity that is already settled.
    /// `None` means the operation is still open and may be attempted again
    /// under the same identity.
    async fn replayed(
        &self,
        task_id: &str,
        operation: &crate::workspace_operations::WorkspaceOperationRecord,
    ) -> Result<Option<WorktreeDiscardResult>, WorktreeDiscardError> {
        match operation.state.as_str() {
            "applied" => {
                let result = operation.result().unwrap_or_default();
                let status = self.status(task_id).await?;
                Ok(Some(WorktreeDiscardResult::settled(&result, status)))
            }
            "conflicted" => Err(WorktreeDiscardError::external_conflict(
                operation.last_error_code.as_deref().unwrap_or("conflict"),
                operation.last_error_message.as_deref().unwrap_or_default(),
            )),
            _ => Ok(None),
        }
    }

    async fn status(&self, task_id: &str) -> Result<WorktreeStatusView, WorktreeDiscardError> {
        Ok(self.status.status(task_id).await?)
    }
}

fn compact(identity: &str) -> String {
    crate::worktree_status::identity::compact_uuid(identity)
}

/// A lease owner that names this process's attempt, so a settlement can only
/// be reported by the worker that claimed it.
fn lease_owner() -> String {
    format!("worktree-discard-{}", uuid::Uuid::new_v4().simple())
}

fn failure(code: &str, message: &str) -> WorktreeDiscardError {
    let code = match code {
        "worktree_git_failed" => WorktreeDiscardErrorCode::GitFailed,
        "worktree_git_unavailable" => WorktreeDiscardErrorCode::GitUnavailable,
        code if code.contains("storage") => WorktreeDiscardErrorCode::Storage,
        _ => WorktreeDiscardErrorCode::OperationInvalid,
    };
    WorktreeDiscardError::new(code, message)
}
