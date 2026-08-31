use chrono::{SecondsFormat, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
};
use seaography::CustomOutputType;
use serde::Serialize;

use crate::worktree::status;
use ticketry_entities::work_management::issue;
use ticketry_entities::worktrees::worktree;

use super::{
    command_git, module_baseline, repository, PullRequestStatusView, WorktreeChangesError,
    WorktreeChangesService,
};

#[derive(Clone, Copy)]
enum TaskPullRequestKind {
    Initial,
    Replacement,
    FollowUp,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct PullRequestCreationResult {
    pub operation_id: String,
    pub url: String,
    pub branch: String,
    pub base_branch: String,
    pub pushed: bool,
    pub uncommitted_work_excluded: bool,
}

impl WorktreeChangesService {
    pub async fn create_task_pull_request(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<PullRequestCreationResult, WorktreeChangesError> {
        self.create_mapped_task_pull_request(task_id, operation_id, TaskPullRequestKind::Initial)
            .await
    }

    pub async fn replace_task_pull_request(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<PullRequestCreationResult, WorktreeChangesError> {
        self.create_mapped_task_pull_request(
            task_id,
            operation_id,
            TaskPullRequestKind::Replacement,
        )
        .await
    }

    pub async fn follow_up_task_pull_request(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<PullRequestCreationResult, WorktreeChangesError> {
        self.create_mapped_task_pull_request(task_id, operation_id, TaskPullRequestKind::FollowUp)
            .await
    }

    async fn create_mapped_task_pull_request(
        &self,
        task_id: &str,
        operation_id: &str,
        kind: TaskPullRequestKind,
    ) -> Result<PullRequestCreationResult, WorktreeChangesError> {
        super::command::validate_operation(operation_id)?;
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let task = issue::Entity::find_by_id(&row.task_id)
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let (repository_root, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        let _guard = self
            .status()
            .repository_locks()
            .acquire(&repository_root)
            .await;
        repository::validate_membership(self.status().git(), &repository_root, &checkout).await?;

        // Re-read under the repository lock so concurrent requests cannot both
        // create from an unmapped snapshot.
        let row = worktree::Entity::find_by_id(&row.id)
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let committed_count =
            command_git::committed_count(self.status().git(), &checkout, &row.base_commit).await?;
        if committed_count == 0 {
            return Err(WorktreeChangesError::pull_request_no_commits());
        }

        let facts =
            command_git::facts(self.status().git(), &checkout, Some(&row.base_commit)).await?;
        match (kind, row.pull_request_url.as_ref()) {
            (TaskPullRequestKind::Initial, Some(_)) => {
                return Err(WorktreeChangesError::pull_request_already_mapped());
            }
            (TaskPullRequestKind::Initial, None) => {}
            (TaskPullRequestKind::Replacement, Some(url)) => {
                let provider = self.github().pull_request(&checkout, url).await?;
                let status = PullRequestStatusView::available(
                    url.clone(),
                    provider,
                    &row.base_branch,
                    &facts.head_commit,
                );
                if !status.replacement_eligible {
                    return Err(WorktreeChangesError::pull_request_not_replaceable());
                }
            }
            (TaskPullRequestKind::FollowUp, Some(url)) => {
                let provider = self.github().pull_request(&checkout, url).await?;
                let status = PullRequestStatusView::available(
                    url.clone(),
                    provider,
                    &row.base_branch,
                    &facts.head_commit,
                );
                if !status.follow_up_eligible {
                    return Err(WorktreeChangesError::pull_request_follow_up_ineligible());
                }
            }
            (TaskPullRequestKind::Replacement, None) => {
                return Err(WorktreeChangesError::pull_request_not_replaceable());
            }
            (TaskPullRequestKind::FollowUp, None) => {
                return Err(WorktreeChangesError::pull_request_follow_up_ineligible());
            }
        }

        self.github().require_authenticated(&checkout).await?;
        let pushed = facts.unpushed_count > 0;
        if pushed {
            command_git::push(self.status().git(), &checkout, &facts).await?;
        }
        let url = self
            .github()
            .create_pull_request(
                &checkout,
                &row.branch,
                &row.base_branch,
                &bounded_title(&task.name),
                &format!(
                    "Created by Ticketry for Work Item {}.",
                    owner.top_level_task_id
                ),
            )
            .await?;

        let mut updated = row.clone().into_active_model();
        updated.pull_request_url = Set(Some(url.clone()));
        updated.updated_at = Set(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false));
        updated.update(self.status().work_items()).await?;

        Ok(PullRequestCreationResult {
            operation_id: operation_id.to_owned(),
            url,
            branch: row.branch,
            base_branch: row.base_branch,
            pushed,
            uncommitted_work_excluded: pushed && facts.dirty,
        })
    }

    pub async fn create_module_pull_request(
        &self,
        module_id: &str,
        operation_id: &str,
    ) -> Result<PullRequestCreationResult, WorktreeChangesError> {
        super::command::validate_operation(operation_id)?;
        let repository = self.module_repository(module_id).await?;
        let _guard = self.status().repository_locks().acquire(&repository).await;
        let target = module_baseline::pull_request_target(self.status().git(), &repository)
            .await?
            .ok_or_else(WorktreeChangesError::pull_request_ineligible_branch)?;
        let committed_count =
            command_git::committed_count(self.status().git(), &repository, &target.base_reference)
                .await?;
        if committed_count == 0 {
            return Err(WorktreeChangesError::pull_request_no_commits());
        }

        self.github().require_authenticated(&repository).await?;
        let facts = command_git::facts(
            self.status().git(),
            &repository,
            Some(&target.base_reference),
        )
        .await?;
        let pushed = facts.unpushed_count > 0;
        if pushed {
            command_git::push(self.status().git(), &repository, &facts).await?;
        }
        let url = self
            .github()
            .create_pull_request(
                &repository,
                &target.branch,
                &target.base_branch,
                &bounded_title(&format!(
                    "Merge {} into {}",
                    target.branch, target.base_branch
                )),
                "Created by Ticketry from the module checkout.",
            )
            .await?;

        Ok(PullRequestCreationResult {
            operation_id: operation_id.to_owned(),
            url,
            branch: target.branch,
            base_branch: target.base_branch,
            pushed,
            uncommitted_work_excluded: pushed && facts.dirty,
        })
    }
}

fn bounded_title(title: &str) -> String {
    title.chars().take(256).collect()
}
