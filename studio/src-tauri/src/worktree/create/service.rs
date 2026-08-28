//! The one place a worktree creation is answered.
//!
//! Studio submits a Work Item identity and an operation identity, and receives
//! the authoritative status of the checkout that now exists. Everything
//! between those two facts — ownership, repository, committed HEAD, base ref,
//! branch, checkout path, the durable operation, the Git effect, the index
//! row, and the published fact — is derived and performed here.
//!
//! Repetition is ordinary. A Work Item that already has a checkout is
//! answered from it without touching Git; an operation identity that is
//! already applied replays its durable result; two concurrent calls for the
//! same Work Item serialize on the repository and converge on one branch, one
//! path, and one row. Reusing an operation identity for *different* intent is
//! the one repetition that is refused, because rebinding a durable identity
//! would make recovery a guess.

use std::sync::Arc;

use sea_orm::DatabaseConnection;

use crate::runs_persistence::StatusEventRepository;
use crate::settings_persistence::ProfileStore;
use crate::workspace::operations::{
    WorkspaceOperationJournal, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
};
use crate::worktree::status::{RepositoryLocks, WorktreeStatusService, WorktreeStatusView};

use super::error::{WorktreeCreateError, WorktreeCreateErrorCode};
use super::executor::CreateExecutor;
use super::identity;
use super::plan::{self, PlanResolution};
use super::probe::CreateProbe;

/// A creation claim is short. The Git work it covers is one `worktree add`,
/// and a worker that dies mid-effect must become eligible again quickly.
const CREATE_LEASE_SECONDS: i64 = 120;

#[derive(Clone)]
pub struct WorktreeCreateService {
    executor: CreateExecutor,
    status: WorktreeStatusService,
}

impl WorktreeCreateService {
    pub fn new(
        work_items: DatabaseConnection,
        profiles: ProfileStore,
        journal: WorkspaceOperationJournal,
        events: Option<StatusEventRepository>,
        locks: RepositoryLocks,
    ) -> Self {
        Self {
            executor: CreateExecutor::new(
                work_items.clone(),
                profiles.clone(),
                journal,
                events,
                locks.clone(),
            ),
            status: WorktreeStatusService::with_locks(work_items, profiles, locks),
        }
    }

    /// The live-status reader this service already shares its repository
    /// locks with. Composition publishes this very instance, so a status read
    /// and a creation in the same process can never observe one repository at
    /// the same moment.
    pub fn status_service(&self) -> &WorktreeStatusService {
        &self.status
    }

    /// The reconciler that drains abandoned creations at startup. It probes
    /// external state before it acts and executes through the very same
    /// executor a user-initiated creation uses.
    pub fn reconciler(&self) -> WorkspaceOperationReconciler {
        self.executor.journal().reconcile_with(
            Arc::new(CreateProbe::new(self.executor.clone())),
            Arc::new(self.executor.clone()),
        )
    }

    /// Create — or converge on — the one checkout this Work Item's top-level
    /// owner has.
    pub async fn create(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<WorktreeStatusView, WorktreeCreateError> {
        let plan = match plan::derive(
            self.executor.work_items(),
            self.executor.profiles(),
            self.executor.git(),
            task_id,
        )
        .await?
        {
            PlanResolution::Plan(plan) => plan,
            // Nothing could enclose this Work Item. That is the same ordinary
            // answer a status read gives, not a failed creation.
            PlanResolution::NoRepository(_) => return Ok(self.status.status(task_id).await?),
        };

        // A Work Item owns at most one checkout, so an existing one is the
        // answer regardless of which operation asked for it.
        if super::row_for(self.executor.work_items(), &plan)
            .await?
            .is_some()
        {
            return Ok(self.status.status(task_id).await?);
        }

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
            .claim(operation_id, &lease_owner(), CREATE_LEASE_SECONDS)
            .await?;
        match self.executor.perform(&claim).await {
            WorkspaceOperationOutcome::Applied { .. } => Ok(self.status.status(task_id).await?),
            WorkspaceOperationOutcome::Conflicted { code, message, .. } => {
                Err(WorktreeCreateError::external_conflict(&code, &message))
            }
            WorkspaceOperationOutcome::Failed { code, message, .. } => {
                Err(failure(&code, &message))
            }
        }
    }

    /// The durable answer for an operation identity that is already settled.
    /// `None` means the operation is still open and may be attempted again
    /// under the same identity.
    async fn replayed(
        &self,
        task_id: &str,
        operation: &crate::workspace::operations::WorkspaceOperationRecord,
    ) -> Result<Option<WorktreeStatusView>, WorktreeCreateError> {
        match operation.state.as_str() {
            "applied" => Ok(Some(self.status.status(task_id).await?)),
            "conflicted" => Err(WorktreeCreateError::external_conflict(
                operation.last_error_code.as_deref().unwrap_or("conflict"),
                operation.last_error_message.as_deref().unwrap_or_default(),
            )),
            _ => Ok(None),
        }
    }
}

/// A lease owner that names this process's attempt, so a settlement can only
/// be reported by the worker that claimed it.
fn lease_owner() -> String {
    format!("worktree-create-{}", uuid::Uuid::new_v4().simple())
}

fn failure(code: &str, message: &str) -> WorktreeCreateError {
    let code = match code {
        "worktree_git_failed" => WorktreeCreateErrorCode::GitFailed,
        "worktree_git_unavailable" => WorktreeCreateErrorCode::GitUnavailable,
        "worktree_repository_unavailable" => WorktreeCreateErrorCode::GitUnavailable,
        code if code.contains("storage") => WorktreeCreateErrorCode::Storage,
        _ => WorktreeCreateErrorCode::OperationInvalid,
    };
    WorktreeCreateError::new(code, message)
}
