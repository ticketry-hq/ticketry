use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::path::Path;

use crate::worktree::status::{self, WorktreeStatusService};
use ticketry_entities::worktrees::worktree;
use ticketry_work_management::work_management::commands::status_facts::WorkFactRecorder;

use super::{git, repository, GithubPort};
use super::{PullRequestStatusView, WorktreeChangesError, WorktreeChangesView};

#[derive(Clone)]
pub struct WorktreeChangesService {
    status: WorktreeStatusService,
    github: GithubPort,
    pub(super) work_facts: Option<WorkFactRecorder>,
}

impl WorktreeChangesService {
    pub(crate) fn from_status(status: WorktreeStatusService) -> Self {
        Self {
            status,
            github: GithubPort::new(),
            work_facts: None,
        }
    }

    pub(crate) fn publishing(mut self, work_facts: Option<WorkFactRecorder>) -> Self {
        self.work_facts = work_facts;
        self
    }

    pub(super) fn status(&self) -> &WorktreeStatusService {
        &self.status
    }

    pub(super) fn github(&self) -> &GithubPort {
        &self.github
    }

    pub async fn changes(
        &self,
        task_id: &str,
    ) -> Result<WorktreeChangesView, WorktreeChangesError> {
        let owner = status::owner::resolve(self.status.work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status.work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;

        let (repository, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        let _guard = self.status.repository_locks().acquire(&repository).await;
        let row = worktree::Entity::find_by_id(&row.id)
            .one(self.status.work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        repository::validate_membership(self.status.git(), &repository, &checkout).await?;
        let facts =
            super::command_git::facts(self.status.git(), &checkout, Some(&row.base_commit)).await?;
        let committed_count =
            super::command_git::committed_count(self.status.git(), &checkout, &row.base_commit)
                .await?;
        let changes = git::cumulative(self.status.git(), &checkout, &row.base_commit).await?;
        let pull_request = self
            .mapped_pull_request_status(&row, &checkout, &facts.head_commit)
            .await;
        let lifecycle = self
            .reconcile_lifecycle(&owner.top_level_row_id(), &pull_request, facts.dirty)
            .await;

        Ok(WorktreeChangesView {
            task_id: owner.requested_task_id,
            top_level_task_id: owner.top_level_task_id,
            is_shared: owner.is_shared,
            base_commit: row.base_commit,
            committed_count,
            pull_request_creation_eligible: committed_count > 0 && row.pull_request_url.is_none(),
            pull_request_url: row.pull_request_url,
            pull_request,
            work_item_done: lifecycle.work_item_done,
            closure_failure: lifecycle.closure_failure,
            cleanup: lifecycle.cleanup,
            clean: !facts.dirty,
            dirty: facts.dirty,
            unpushed_count: facts.unpushed_count,
            truncated: changes.truncated,
            files: changes.files,
        })
    }

    pub(super) async fn mapped_pull_request_status(
        &self,
        row: &worktree::Model,
        checkout: &Path,
        checkout_head: &str,
    ) -> PullRequestStatusView {
        let Some(url) = row.pull_request_url.as_ref() else {
            return PullRequestStatusView::none();
        };
        match self.github.pull_request(checkout, url).await {
            Ok(provider) => PullRequestStatusView::available(
                url.clone(),
                provider,
                &row.base_branch,
                checkout_head,
            ),
            Err(_) => PullRequestStatusView::unavailable(url.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use sea_orm::Database;

    use crate::worktree::status::RepositoryLocks;

    use super::*;

    #[tokio::test]
    async fn construction_from_status_reuses_the_same_repository_lock() {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open test database");
        let locks = RepositoryLocks::new();
        let status = WorktreeStatusService::with_locks(database, locks);
        let changes = WorktreeChangesService::from_status(status.clone());
        let repository = PathBuf::from("/repositories/shared");
        let held = status.repository_locks().acquire(&repository).await;

        let contended = tokio::time::timeout(
            Duration::from_millis(100),
            changes.status.repository_locks().acquire(&repository),
        )
        .await;

        assert!(contended.is_err(), "changes must wait on status' lock");
        drop(held);
    }
}
