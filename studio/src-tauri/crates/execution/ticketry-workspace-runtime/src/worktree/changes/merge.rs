use std::path::PathBuf;
use std::sync::Arc;

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use ticketry_entities::worktree;

use crate::workspace::operations::{
    WorkspaceOperationJournal, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
};
use crate::worktree::{create, status};

use super::merge_executor::MergeExecutor;
use super::merge_git::is_ancestor;
use super::merge_identity::{self, MergeIntent};
use super::merge_probe::MergeProbe;
use super::merge_result::{merge_error_code, WorktreeMergeResult};
use super::{merge_preview, repository, WorktreeChangesError, WorktreeChangesService};

const MERGE_LEASE_SECONDS: i64 = 120;

impl WorktreeChangesService {
    pub fn merge_reconciler(&self) -> WorkspaceOperationReconciler {
        let executor = MergeExecutor::new(
            self.status().clone(),
            WorkspaceOperationJournal::new(self.status().work_items().clone()),
        );
        executor.journal.clone().reconcile_with(
            Arc::new(MergeProbe::new(executor.clone())),
            Arc::new(executor),
        )
    }

    pub async fn merge(
        &self,
        task_id: &str,
        operation_id: &str,
        destination_branch: &str,
        confirmation_token: &str,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        let journal = WorkspaceOperationJournal::new(self.status().work_items().clone());
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let existing = journal
            .find(operation_id)
            .await
            .map_err(WorktreeChangesError::merge_operation)?;
        let operation = match existing {
            Some(operation) => {
                let matches = operation
                    .intent_payload()
                    .as_ref()
                    .and_then(MergeIntent::decode)
                    .is_some_and(|intent| {
                        intent.task_id == owner.top_level_row_id()
                            && intent.destination_branch == destination_branch
                            && merge_preview::confirmation_token(
                                &intent.worktree_id,
                                &intent.source_branch,
                                &intent.source_commit,
                                &intent.destination_branch,
                                &intent.destination_commit,
                                &intent.destination_checkout_identity,
                            ) == confirmation_token
                    });
                if !matches {
                    return Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_operation_mismatch",
                        "This operation identity belongs to a different merge intent.",
                    ));
                }
                operation
            }
            None => {
                let preview = self
                    .merge_preview(task_id, Some(destination_branch))
                    .await?;
                if !preview.ready
                    || preview.confirmation_token.as_deref() != Some(confirmation_token)
                {
                    return Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_preview_stale",
                        "The merge preview changed. Refresh and confirm it again.",
                    ));
                }
                let source_commit = preview.source_commit.expect("ready preview source commit");
                let destination_commit = preview
                    .destination_commit
                    .expect("ready preview destination commit");
                let source_is_ancestor = is_ancestor(
                    self.status(),
                    &source_commit,
                    &destination_commit,
                    self.repository_for(&owner.top_level_row_id())
                        .await?
                        .0
                        .as_path(),
                )
                .await?;
                let destination_is_ancestor = is_ancestor(
                    self.status(),
                    &destination_commit,
                    &source_commit,
                    self.repository_for(&owner.top_level_row_id())
                        .await?
                        .0
                        .as_path(),
                )
                .await?;
                let action = if source_is_ancestor {
                    "already_integrated"
                } else if destination_is_ancestor {
                    "fast_forward"
                } else {
                    "merge"
                };
                let row = worktree::Entity::find()
                    .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
                    .one(self.status().work_items())
                    .await?
                    .ok_or_else(WorktreeChangesError::not_found)?;
                let intent = MergeIntent {
                    worktree_id: row.id,
                    task_id: owner.top_level_row_id(),
                    repository_digest: create::identity::repository_digest(
                        &repository::recorded_repository(&row.repo_root)?,
                    ),
                    source_branch: preview.source_branch,
                    source_commit,
                    destination_branch: destination_branch.to_owned(),
                    destination_commit,
                    destination_checkout_identity: preview
                        .destination_checkout_identity
                        .expect("ready preview checkout identity"),
                    action: action.to_owned(),
                };
                journal
                    .prepare(merge_identity::intent(operation_id, &intent))
                    .await
                    .map_err(WorktreeChangesError::merge_operation)?
                    .operation
            }
        };

        let intent = operation
            .intent_payload()
            .as_ref()
            .and_then(MergeIntent::decode)
            .ok_or_else(|| {
                WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_invalid",
                    "The prepared merge cannot be decoded by this build.",
                )
            })?;
        let executor = MergeExecutor::new(self.status().clone(), journal.clone());
        if operation.state == "conflicted" {
            return executor.result(operation_id, &intent).await;
        }
        if matches!(operation.state.as_str(), "failed" | "cleanup_pending") {
            return Err(WorktreeChangesError::merge_blocked(
                merge_error_code(operation.last_error_code.as_deref().unwrap_or_default()),
                operation
                    .last_error_message
                    .unwrap_or_else(|| "The merge could not be verified.".to_owned()),
            ));
        }
        if operation.state != "applied" {
            let claim = journal
                .claim(operation_id, &lease_owner(), MERGE_LEASE_SECONDS)
                .await
                .map_err(WorktreeChangesError::merge_operation)?;
            match executor.perform(&claim).await {
                WorkspaceOperationOutcome::Applied { .. } => {}
                WorkspaceOperationOutcome::Conflicted { .. } => {}
                WorkspaceOperationOutcome::Failed { code, message, .. } => {
                    return Err(WorktreeChangesError::merge_blocked(
                        merge_error_code(&code),
                        message,
                    ))
                }
            }
        }
        executor.result(operation_id, &intent).await
    }

    pub(super) async fn repository_for(
        &self,
        task_id: &str,
    ) -> Result<(PathBuf, worktree::Model), WorktreeChangesError> {
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(task_id))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        Ok((repository::recorded_repository(&row.repo_root)?, row))
    }
}

fn lease_owner() -> String {
    format!("worktree-merge-{}", uuid::Uuid::new_v4().simple())
}
