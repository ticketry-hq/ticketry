use chrono::{SecondsFormat, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
};
use std::path::Path;

use crate::worktree::status::{self, WorktreeStatusService};
use ticketry_entities::{ship_record, worktree};
use ticketry_work_management::commands::status_facts::WorkFactRecorder;

use super::{git, repository, GithubPort};
use super::{PullRequestStatusView, WorktreeChangesError, WorktreeChangesView};

#[derive(Clone)]
pub struct WorktreeChangesService {
    status: WorktreeStatusService,
    github: GithubPort,
    pub(super) work_facts: Option<WorkFactRecorder>,
}

impl WorktreeChangesService {
    pub fn from_status(status: WorktreeStatusService) -> Self {
        Self {
            status,
            github: GithubPort::new(),
            work_facts: None,
        }
    }

    pub fn publishing(mut self, work_facts: Option<WorkFactRecorder>) -> Self {
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
        for _attempt in 0..3 {
            let row = worktree::Entity::find()
                .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
                .one(self.status.work_items())
                .await?
                .ok_or_else(WorktreeChangesError::not_found)?;

            let (repository, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
            let guard = self.status.repository_locks().acquire(&repository).await;
            let row = worktree::Entity::find_by_id(&row.id)
                .one(self.status.work_items())
                .await?
                .ok_or_else(WorktreeChangesError::not_found)?;
            repository::validate_membership(self.status.git(), &repository, &checkout).await?;
            let observed_head =
                super::command_git::head_commit(self.status.git(), &checkout).await?;
            drop(guard);

            let pull_request = self
                .mapped_pull_request_status(&row, &checkout, &observed_head)
                .await;

            let _guard = self.status.repository_locks().acquire(&repository).await;
            let current = worktree::Entity::find_by_id(&row.id)
                .one(self.status.work_items())
                .await?
                .ok_or_else(WorktreeChangesError::not_found)?;
            repository::validate_membership(self.status.git(), &repository, &checkout).await?;
            // GitHub can take seconds. Read mutable checkout facts only after
            // reacquiring the lock, and share this status across both calculations.
            let status = super::command_git::status(self.status.git(), &checkout).await?;
            let facts = super::command_git::facts_from_status(
                self.status.git(),
                &checkout,
                Some(&row.base_commit),
                &status,
            )
            .await?;
            let committed_count =
                super::command_git::committed_count(self.status.git(), &checkout, &row.base_commit)
                    .await?;
            let changes = git::cumulative_from_status(
                self.status.git(),
                &checkout,
                &row.base_commit,
                &status,
            )
            .await?;
            let insertions = changes.files.iter().filter_map(|f| f.insertions).sum();
            let deletions = changes.files.iter().filter_map(|f| f.deletions).sum();
            if !same_remote_observation(&row, &current, &observed_head, &facts.head_commit) {
                continue;
            }

            let lifecycle = self
                .reconcile_lifecycle(&owner.top_level_row_id(), &pull_request, facts.dirty)
                .await;

            return Ok(WorktreeChangesView {
                task_id: owner.requested_task_id.clone(),
                top_level_task_id: owner.top_level_task_id.clone(),
                is_shared: owner.is_shared,
                base_commit: row.base_commit,
                committed_count,
                pull_request_creation_eligible: committed_count > 0
                    && row.pull_request_url.is_none(),
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
                insertions,
                deletions,
            });
        }
        Err(WorktreeChangesError::git_state_unavailable(
            "The worktree changed while Ticketry was reading pull-request status.",
        ))
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
        if let Ok(Some(record)) = ship_record::Entity::find()
            .filter(ship_record::Column::TaskId.eq(row.task_id.clone()))
            .filter(ship_record::Column::PrUrl.eq(url.clone()))
            .order_by_desc(ship_record::Column::ActedAt)
            .one(self.status.work_items())
            .await
        {
            if matches!(record.pr_state.as_deref(), Some("merged" | "closed")) {
                return PullRequestStatusView::cached(
                    url.clone(),
                    record.pr_state.as_deref().unwrap_or_default(),
                    record.pr_target_branch.as_deref(),
                    record.pr_head_commit.as_deref(),
                    &row.base_branch,
                    checkout_head,
                );
            }
        }
        match self.github.pull_request(checkout, url).await {
            Ok(provider) => {
                let view = PullRequestStatusView::available(
                    url.clone(),
                    provider.clone(),
                    &row.base_branch,
                    checkout_head,
                );
                if matches!(provider.state.as_str(), "MERGED" | "CLOSED") {
                    let _ = cache_terminal_verdict(
                        self.status.work_items(),
                        Some(row.task_id.as_str()),
                        url,
                        &view,
                    )
                    .await;
                }
                view
            }
            Err(_) => PullRequestStatusView::unavailable(url.clone()),
        }
    }
}

async fn cache_terminal_verdict(
    database: &sea_orm::DatabaseConnection,
    task_id: Option<&str>,
    url: &str,
    view: &PullRequestStatusView,
) -> Result<(), sea_orm::DbErr> {
    let Some(task_id) = task_id else {
        return Ok(());
    };
    let Some(record) = ship_record::Entity::find()
        .filter(ship_record::Column::TaskId.eq(task_id))
        .filter(ship_record::Column::PrUrl.eq(url))
        .order_by_desc(ship_record::Column::ActedAt)
        .one(database)
        .await?
    else {
        return Ok(());
    };
    let mut update: ship_record::ActiveModel = record.into();
    update.pr_state = Set(Some(
        if view.state == "merged" {
            "merged"
        } else {
            "closed"
        }
        .to_owned(),
    ));
    update.pr_target_branch = Set(view.target_branch.clone());
    update.pr_head_commit = Set(view.head_commit.clone());
    update.pr_refreshed_at = Set(Some(
        Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false),
    ));
    update.update(database).await.map(|_| ())
}

impl WorktreeChangesService {
    pub async fn file_diff(
        &self,
        task_id: &str,
        requested_path: &str,
    ) -> Result<super::file_diff::FileDiffView, WorktreeChangesError> {
        let owner = status::owner::resolve(self.status.work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status.work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let (repository, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        let _guard = self.status.repository_locks().acquire(&repository).await;
        let current = worktree::Entity::find_by_id(&row.id)
            .one(self.status.work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        if current.repo_root != row.repo_root || current.path != row.path {
            return Err(WorktreeChangesError::git_state_unavailable(
                "The task worktree changed while Ticketry was reading its file patch.",
            ));
        }
        repository::validate_membership(self.status.git(), &repository, &checkout).await?;
        let status = super::command_git::status(self.status.git(), &checkout).await?;
        let changes = git::cumulative_from_status(
            self.status.git(),
            &checkout,
            &current.base_commit,
            &status,
        )
        .await?;
        let Some(file) = changes
            .files
            .into_iter()
            .find(|file| file.path == requested_path)
        else {
            return Err(WorktreeChangesError::file_path_invalid());
        };
        super::file_diff::bounded(
            self.status.git(),
            &checkout,
            &file.path,
            file.previous_path.as_deref(),
            &file.status,
            file.binary,
        )
        .await
    }
}

fn same_remote_observation(
    before: &worktree::Model,
    after: &worktree::Model,
    before_head: &str,
    after_head: &str,
) -> bool {
    before.id == after.id
        && before.repo_root == after.repo_root
        && before.path == after.path
        && before.base_commit == after.base_commit
        && before.base_branch == after.base_branch
        && before.pull_request_url == after.pull_request_url
        && before_head == after_head
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use sea_orm::Database;

    use crate::worktree::status::RepositoryLocks;

    use super::*;

    fn recorded_worktree() -> worktree::Model {
        worktree::Model {
            id: "worktree-1".to_owned(),
            task_id: "task-1".to_owned(),
            workspace_slug: Some("ticketry".to_owned()),
            project_id: Some("project-1".to_owned()),
            module_id: Some("module-1".to_owned()),
            ticket_seq: Some(1),
            repo_root: "/repositories/shared".to_owned(),
            path: "/repositories/shared/worktrees/task-1".to_owned(),
            branch: "ticketry/task-1".to_owned(),
            base_branch: "main".to_owned(),
            base_commit: "a".repeat(40),
            status: "active".to_owned(),
            ephemeral: false,
            created_at: "2026-09-05T00:00:00Z".to_owned(),
            updated_at: "2026-09-05T00:00:00Z".to_owned(),
            pull_request_url: Some("https://github.com/acme/repo/pull/1".to_owned()),
        }
    }

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

    #[test]
    fn remote_results_apply_only_to_the_checkout_that_was_observed() {
        let before = recorded_worktree();
        assert!(same_remote_observation(
            &before,
            &before,
            &"b".repeat(40),
            &"b".repeat(40)
        ));

        let mut changed_pull_request = before.clone();
        changed_pull_request.pull_request_url = None;
        assert!(!same_remote_observation(
            &before,
            &changed_pull_request,
            &"b".repeat(40),
            &"b".repeat(40),
        ));

        let mut changed_checkout = before.clone();
        changed_checkout.path.push_str("-replacement");
        assert!(!same_remote_observation(
            &before,
            &changed_checkout,
            &"b".repeat(40),
            &"b".repeat(40),
        ));

        assert!(!same_remote_observation(
            &before,
            &before,
            &"b".repeat(40),
            &"c".repeat(40),
        ));
    }
}
