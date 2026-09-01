use std::sync::Arc;

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::worktree::status;
use ticketry_entities::worktree;
use ticketry_work_management::launch_policy::{
    CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

use super::super::{
    command, command_git, repository, PullRequestStatusView, WorktreeChangesService,
};
use super::error::MergePreparationError;
use super::launcher::MergePreparationLauncher;
use super::prompt;
use super::types::MergePreparationResult;

#[derive(Clone)]
pub struct MergePreparationService {
    changes: WorktreeChangesService,
    policy: LaunchPolicyResolver,
    launcher: Arc<dyn MergePreparationLauncher>,
}

impl MergePreparationService {
    /// The caller composes the launcher, so worktree never names a runtime.
    pub fn new(
        changes: WorktreeChangesService,
        launcher: Arc<dyn MergePreparationLauncher>,
    ) -> Self {
        let database = changes.status().work_items().clone();
        Self {
            changes,
            policy: LaunchPolicyResolver::new(database),
            launcher,
        }
    }

    pub async fn launch(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<MergePreparationResult, MergePreparationError> {
        command::validate_operation(operation_id)?;
        let database = self.changes.status().work_items();
        let owner = status::owner::resolve(database, task_id)
            .await
            .map_err(super::super::WorktreeChangesError::from)?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(database)
            .await?
            .ok_or_else(MergePreparationError::worktree_unavailable)?;
        if !matches!(row.status.as_str(), "active" | "conflict") {
            return Err(MergePreparationError::worktree_unavailable());
        }
        let (repository_root, checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        let _guard = self
            .changes
            .status()
            .repository_locks()
            .acquire(&repository_root)
            .await;
        repository::validate_membership(self.changes.status().git(), &repository_root, &checkout)
            .await?;

        let row = worktree::Entity::find_by_id(&row.id)
            .one(database)
            .await?
            .filter(|current| matches!(current.status.as_str(), "active" | "conflict"))
            .ok_or_else(MergePreparationError::worktree_unavailable)?;
        let pull_request_url = row
            .pull_request_url
            .as_deref()
            .ok_or_else(MergePreparationError::pull_request_missing)?;
        let facts = command_git::facts(
            self.changes.status().git(),
            &checkout,
            Some(&row.base_commit),
        )
        .await?;
        let provider = self
            .changes
            .github()
            .pull_request(&checkout, pull_request_url)
            .await?;
        let status = PullRequestStatusView::available(
            pull_request_url.to_owned(),
            provider,
            &row.base_branch,
            &facts.head_commit,
        );
        if !status.merge_preparation_eligible {
            return Err(MergePreparationError::ineligible());
        }

        let mut decision = self
            .policy
            .resolve(LaunchPolicyRequest {
                task_id: owner.top_level_task_id.clone(),
                destination_state_id: None,
                provider_override: None,
                caller_scope: CallerScope::Interactive,
                idempotency_key: operation_id.to_owned(),
            })
            .await?;
        decision.prompt = prompt::build(&row, &status, pull_request_url);
        let launched = self.launcher.launch(&decision).await?;

        Ok(MergePreparationResult {
            operation_id: operation_id.to_owned(),
            top_level_task_id: owner.top_level_task_id,
            agent_run_id: launched.agent_run_id,
            agent: launched.agent,
            branch: row.branch,
            pull_request_url: pull_request_url.to_owned(),
        })
    }
}
