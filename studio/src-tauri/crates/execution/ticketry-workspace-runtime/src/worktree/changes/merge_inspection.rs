use std::path::PathBuf;

use sea_orm::EntityTrait;
use ticketry_entities::worktree;

use crate::worktree::{create, status};

use super::merge_executor::MergeExecutor;
use super::merge_git::{git_ref, is_ancestor, unmerged_paths};
use super::merge_identity::MergeIntent;
use super::merge_result::stale;
use super::{command_git, merge_preview, repository, WorktreeChangesError};

pub(super) struct MergeLocation {
    pub(super) destination: PathBuf,
    pub(super) destination_head: String,
}

pub(super) enum MergeState {
    Ready(MergeLocation),
    Applied(MergeLocation),
    Conflicted(MergeLocation, Vec<String>),
}

impl MergeExecutor {
    pub(super) async fn inspect(
        &self,
        intent: &MergeIntent,
        require_current_source: bool,
    ) -> Result<MergeState, WorktreeChangesError> {
        let row = worktree::Entity::find_by_id(&intent.worktree_id)
            .one(self.status.work_items())
            .await?
            .ok_or_else(|| stale("The source worktree record changed."))?;
        if row.task_id != intent.task_id || row.branch != intent.source_branch {
            return Err(stale("The source worktree identity changed."));
        }
        let (repository, source) = repository::recorded_paths(&row.repo_root, &row.path)?;
        if create::identity::repository_digest(&repository) != intent.repository_digest {
            return Err(stale("The source repository changed."));
        }
        let registered = status::registry::checkouts(self.status.git(), &repository).await?;
        if !registered.iter().any(|entry| {
            entry.branch.as_deref() == Some(intent.source_branch.as_str())
                && status::registry::same_path(&entry.path, &source)
        }) {
            return Err(stale("The source checkout no longer owns its branch."));
        }
        let destination = registered
            .iter()
            .find(|entry| entry.branch.as_deref() == Some(intent.destination_branch.as_str()))
            .map(|entry| PathBuf::from(&entry.path).canonicalize())
            .transpose()
            .map_err(|_| stale("The destination checkout is unavailable."))?
            .ok_or_else(|| stale("The destination checkout no longer owns its branch."))?;
        if merge_preview::checkout_identity(&destination) != intent.destination_checkout_identity {
            return Err(stale("The destination checkout changed after preview."));
        }
        repository::validate_membership(self.status.git(), &repository, &source).await?;
        repository::validate_membership(self.status.git(), &repository, &destination).await?;
        if require_current_source {
            if merge_preview::in_progress(self.status.git(), &source).await? {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_in_progress",
                    "Finish or abort the existing Git operation, then preview again.",
                ));
            }
            if !command_git::status(self.status.git(), &source)
                .await?
                .stdout
                .is_empty()
            {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_dirty",
                    "The source checkout must remain clean.",
                ));
            }
            let source_head = command_git::head_commit(self.status.git(), &source).await?;
            if source_head != intent.source_commit {
                return Err(stale("The source branch changed after preview."));
            }
        }
        let destination_head = command_git::head_commit(self.status.git(), &destination).await?;
        let location = MergeLocation {
            destination,
            destination_head: destination_head.clone(),
        };
        if let Some(merge_head) =
            git_ref(self.status.git(), &location.destination, "MERGE_HEAD").await?
        {
            let original_head =
                git_ref(self.status.git(), &location.destination, "ORIG_HEAD").await?;
            if intent.action != "merge"
                || merge_head != intent.source_commit
                || original_head.as_deref() != Some(intent.destination_commit.as_str())
                || destination_head != intent.destination_commit
            {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_mismatch",
                    "The destination has a different Git operation in progress.",
                ));
            }
            let paths = unmerged_paths(self.status.git(), &location.destination).await?;
            return Ok(MergeState::Conflicted(location, paths));
        }
        if merge_preview::in_progress(self.status.git(), &location.destination).await? {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_operation_mismatch",
                "The destination has a different Git operation in progress.",
            ));
        }
        if intent.action == "fast_forward" && destination_head == intent.source_commit {
            return Ok(MergeState::Applied(location));
        }
        let source_in_destination = is_ancestor(
            &self.status,
            &intent.source_commit,
            &destination_head,
            &repository,
        )
        .await?;
        if intent.action == "already_integrated" && source_in_destination {
            return Ok(MergeState::Applied(location));
        }
        if matches!(intent.action.as_str(), "merge" | "fast_forward") && source_in_destination {
            return Ok(MergeState::Applied(location));
        }
        if !command_git::status(self.status.git(), &location.destination)
            .await?
            .stdout
            .is_empty()
        {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_dirty",
                "The destination checkout must remain clean.",
            ));
        }
        if destination_head != intent.destination_commit {
            return Err(stale("The destination branch changed after preview."));
        }
        if intent.action == "merge" {
            return Ok(MergeState::Ready(location));
        }
        if intent.action != "fast_forward"
            || !is_ancestor(
                &self.status,
                &destination_head,
                &intent.source_commit,
                &repository,
            )
            .await?
        {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_divergent_history",
                "The branches have diverged. No Git state was changed.",
            ));
        }
        Ok(MergeState::Ready(location))
    }
}
