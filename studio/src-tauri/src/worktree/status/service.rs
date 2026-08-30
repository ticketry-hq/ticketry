//! The one place a worktree status answer is assembled.
//!
//! The caller supplies a Work Item identity and nothing else. Ownership,
//! module, linked folder, repository, branch, base, and checkout identity are
//! all derived here from trusted data, and the live facts are read from Git
//! under the owning repository's lock.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::worktrees::worktree;

use super::error::WorktreeStatusError;
use super::git::GitPort;
use super::live_facts;
use super::owner::{self, WorktreeOwner};
use super::repository::{self, RepositoryResolution};
use super::repository_locks::RepositoryLocks;
use super::view::WorktreeStatusView;

/// Reads live worktree status. Cloning shares the repository locks, so every
/// caller in the process serializes against the same repository.
#[derive(Clone)]
pub struct WorktreeStatusService {
    work_items: DatabaseConnection,
    git: GitPort,
    locks: RepositoryLocks,
}

impl WorktreeStatusService {
    pub fn new(work_items: DatabaseConnection) -> Self {
        Self::with_locks(work_items, RepositoryLocks::new())
    }

    /// Share one set of repository locks with the other worktree capabilities
    /// in this process, so a status read and a creation never observe the same
    /// repository at the same time.
    pub fn with_locks(work_items: DatabaseConnection, locks: RepositoryLocks) -> Self {
        Self {
            work_items,
            git: GitPort::new(),
            locks,
        }
    }

    /// The locks this service serializes Git work on, so later worktree
    /// operations in the same process share them rather than opening a second,
    /// independent set.
    pub fn repository_locks(&self) -> &RepositoryLocks {
        &self.locks
    }

    pub(crate) fn work_items(&self) -> &DatabaseConnection {
        &self.work_items
    }

    pub(crate) fn git(&self) -> &GitPort {
        &self.git
    }

    pub async fn status(&self, task_id: &str) -> Result<WorktreeStatusView, WorktreeStatusError> {
        let owner = owner::resolve(&self.work_items, task_id).await?;
        match self.row_for(&owner).await? {
            Some(row) => self.live_status(&owner, row).await,
            None => self.absent_status(&owner).await,
        }
    }

    /// The worktree index is keyed by the owning Work Item, so a child and its
    /// parent read the very same row.
    async fn row_for(
        &self,
        owner: &WorktreeOwner,
    ) -> Result<Option<worktree::Model>, WorktreeStatusError> {
        Ok(worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(&self.work_items)
            .await?)
    }

    async fn live_status(
        &self,
        owner: &WorktreeOwner,
        row: worktree::Model,
    ) -> Result<WorktreeStatusView, WorktreeStatusError> {
        let repository = std::path::PathBuf::from(&row.repo_root);
        let repository = repository.canonicalize().unwrap_or(repository);
        // Status-sensitive Git work for this repository is serialized; another
        // repository stays free.
        let _guard = self.locks.acquire(&repository).await;
        let facts = live_facts::observe(
            &self.git,
            std::path::Path::new(&row.path),
            &row.base_branch,
            row.status == "conflict",
        )
        .await?;
        Ok(WorktreeStatusView::worktree(owner, &row, facts))
    }

    /// No row: the answer is whether one could exist at all. `none` offers
    /// creation; `no_repo` explains why creation is not on the table.
    async fn absent_status(
        &self,
        owner: &WorktreeOwner,
    ) -> Result<WorktreeStatusView, WorktreeStatusError> {
        match repository::resolve(&self.work_items, &self.git, owner.module_id.as_deref()).await? {
            RepositoryResolution::Repository(_) => Ok(WorktreeStatusView::none(owner)),
            RepositoryResolution::NoRepository(reason) => {
                Ok(WorktreeStatusView::no_repository(owner, reason))
            }
        }
    }
}
