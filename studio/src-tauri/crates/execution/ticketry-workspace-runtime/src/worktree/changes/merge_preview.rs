use std::path::{Path, PathBuf};

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use sha2::{Digest, Sha256};
use ticketry_entities::worktree;

use crate::worktree::status::{self, GitPort};
use crate::{
    workspace::operations::{WorkspaceOperationJournal, WorkspaceOperationKind},
    worktree::create,
};

use super::{
    repository, view::blocked, LocalMergeDestinationView, WorktreeChangesError,
    WorktreeChangesService, WorktreeMergePreviewView,
};

impl WorktreeChangesService {
    pub async fn merge_preview(
        &self,
        task_id: &str,
        requested_destination: Option<&str>,
    ) -> Result<WorktreeMergePreviewView, WorktreeChangesError> {
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        let (repository, source_checkout) = repository::recorded_paths(&row.repo_root, &row.path)?;
        let _guard = self.status().repository_locks().acquire(&repository).await;
        repository::validate_membership(self.status().git(), &repository, &source_checkout).await?;

        let registered = status::registry::checkouts(self.status().git(), &repository).await?;
        let destinations =
            local_destinations(self.status().git(), &repository, &registered).await?;

        if !source_matches_record(&registered, &source_checkout, &row.branch) {
            return Ok(blocked(
                row.branch,
                None,
                None,
                "source_unverifiable",
                "The task worktree is detached or no longer checks out its recorded source branch.",
                false,
                destinations,
            ));
        }
        if in_progress(self.status().git(), &source_checkout).await? {
            return Ok(blocked(
                row.branch,
                None,
                None,
                "source_operation_in_progress",
                "Finish or abort the Git operation in the task worktree, then retry.",
                false,
                destinations,
            ));
        }
        if !super::command_git::status(self.status().git(), &source_checkout)
            .await?
            .stdout
            .is_empty()
        {
            return Ok(blocked(
                row.branch,
                None,
                None,
                "source_dirty",
                "Commit or discard the task worktree's uncommitted changes, then retry.",
                false,
                destinations,
            ));
        }

        let destination = match requested_destination {
            Some(branch) => {
                if !valid_branch(self.status().git(), &repository, branch).await? {
                    return Ok(blocked(
                        row.branch,
                        None,
                        None,
                        "destination_invalid",
                        "Choose a valid local branch as the merge destination.",
                        true,
                        destinations,
                    ));
                }
                if !status::registry::branch_exists(self.status().git(), &repository, branch)
                    .await?
                {
                    return Ok(blocked(
                        row.branch,
                        Some(branch.to_owned()),
                        None,
                        "destination_missing",
                        "That local destination branch no longer exists. Choose another branch.",
                        true,
                        destinations,
                    ));
                }
                branch.to_owned()
            }
            None => {
                if !trustworthy_provenance(
                    self.status().work_items(),
                    self.status().git(),
                    &repository,
                    owner.top_level_row_id(),
                    &row.id,
                    &row.branch,
                    &row.base_branch,
                    &row.base_commit,
                )
                .await?
                {
                    return Ok(blocked(
                        row.branch,
                        None,
                        None,
                        "destination_selection_required",
                        "The recorded merge destination cannot be verified. Choose an existing local branch.",
                        true,
                        destinations,
                    ));
                }
                row.base_branch
            }
        };

        if destination == row.branch {
            return Ok(blocked(
                row.branch,
                Some(destination),
                Some(source_checkout.display().to_string()),
                "self_destination",
                "Choose a destination other than the task worktree's source branch.",
                false,
                destinations,
            ));
        }

        let destination_checkout = destinations
            .iter()
            .find(|candidate| candidate.branch == destination)
            .and_then(|candidate| candidate.checkout.clone());
        let Some(destination_checkout) = destination_checkout else {
            return Ok(blocked(
                row.branch,
                Some(destination),
                None,
                "destination_checkout_missing",
                "Check out the destination branch locally, then retry the preview.",
                false,
                destinations,
            ));
        };
        let destination_path = Path::new(&destination_checkout);

        if in_progress(self.status().git(), destination_path).await? {
            return Ok(blocked(
                row.branch,
                Some(destination),
                Some(destination_checkout),
                "destination_operation_in_progress",
                "Finish or abort the Git operation in the destination checkout, then retry.",
                false,
                destinations,
            ));
        }
        if !super::command_git::status(self.status().git(), destination_path)
            .await?
            .stdout
            .is_empty()
        {
            return Ok(blocked(
                row.branch,
                Some(destination),
                Some(destination_checkout),
                "destination_dirty",
                "Make the destination checkout clean, then retry the preview.",
                false,
                destinations,
            ));
        }

        let source_commit =
            super::command_git::head_commit(self.status().git(), &source_checkout).await?;
        let destination_commit =
            super::command_git::head_commit(self.status().git(), destination_path).await?;
        let destination_checkout_identity = checkout_identity(destination_path);
        let confirmation_token = confirmation_token(
            &row.id,
            &row.branch,
            &source_commit,
            &destination,
            &destination_commit,
            &destination_checkout_identity,
        );
        let merge_base = self
            .status()
            .git()
            .run(
                &["merge-base", &destination_commit, &source_commit],
                &repository,
            )
            .await?;
        if !merge_base.succeeded {
            return Ok(blocked(
                row.branch,
                Some(destination),
                Some(destination_checkout),
                "incompatible_histories",
                "The source and destination do not share Git history and cannot be merged.",
                false,
                destinations,
            ));
        }
        Ok(WorktreeMergePreviewView {
            source_branch: row.branch,
            source_commit: Some(source_commit),
            destination_branch: Some(destination),
            destination_commit: Some(destination_commit),
            destination_checkout: Some(destination_checkout),
            destination_checkout_identity: Some(destination_checkout_identity),
            confirmation_token: Some(confirmation_token),
            ready: true,
            blocker: None,
            reason: None,
            requires_destination_selection: false,
            destinations,
        })
    }
}

pub(super) fn checkout_identity(checkout: &Path) -> String {
    digest(&checkout.to_string_lossy())
}

pub(super) fn confirmation_token(
    worktree_id: &str,
    source_branch: &str,
    source_commit: &str,
    destination_branch: &str,
    destination_commit: &str,
    destination_checkout_identity: &str,
) -> String {
    digest(&format!(
        "{worktree_id}\0{source_branch}\0{source_commit}\0{destination_branch}\0{destination_commit}\0{destination_checkout_identity}"
    ))
}

fn digest(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn source_matches_record(
    registered: &[status::registry::RegisteredCheckout],
    checkout: &Path,
    branch: &str,
) -> bool {
    registered.iter().any(|entry| {
        entry.branch.as_deref() == Some(branch)
            && status::registry::same_path(&entry.path, checkout)
    })
}

async fn valid_branch(
    git: &GitPort,
    repository: &Path,
    branch: &str,
) -> Result<bool, WorktreeChangesError> {
    if branch.is_empty() || branch == "HEAD" || is_oid(branch) {
        return Ok(false);
    }
    Ok(git
        .run(&["check-ref-format", "--branch", branch], repository)
        .await?
        .succeeded)
}

async fn trustworthy_provenance(
    database: &sea_orm::DatabaseConnection,
    git: &GitPort,
    repository: &Path,
    task_id: String,
    worktree_id: &str,
    source_branch: &str,
    branch: &str,
    base_commit: &str,
) -> Result<bool, WorktreeChangesError> {
    if !valid_branch(git, repository, branch).await?
        || !status::registry::branch_exists(git, repository, branch).await?
    {
        return Ok(false);
    }
    let Some(created) = WorkspaceOperationJournal::new(database.clone())
        .find_latest_applied(
            WorkspaceOperationKind::WorktreeCreate,
            &create::identity::resource_key(&task_id),
        )
        .await
        .map_err(|_| {
            WorktreeChangesError::git_state_unavailable(
                "The task worktree's creation provenance could not be read.",
            )
        })?
    else {
        return Ok(false);
    };
    if created.intent_version != create::identity::INTENT_VERSION {
        return Ok(false);
    }
    let Some(payload) = created.intent_payload() else {
        return Ok(false);
    };
    let Some(result) = created.result() else {
        return Ok(false);
    };
    let Some(evidence) = created.evidence_value() else {
        return Ok(false);
    };
    if payload["branch"] != source_branch
        || payload["baseRef"] != branch
        || payload["baseCommit"] != base_commit
        || result["worktreeId"] != worktree_id
        || result["baseRef"] != branch
        || result["baseCommit"] != base_commit
        || evidence["worktreeId"] != worktree_id
        || evidence["baseRef"] != branch
        || evidence["baseCommit"] != base_commit
    {
        return Ok(false);
    }
    let branch_ref = format!("refs/heads/{branch}");
    Ok(git
        .run(
            &["merge-base", "--is-ancestor", base_commit, &branch_ref],
            repository,
        )
        .await?
        .succeeded)
}

async fn local_destinations(
    git: &GitPort,
    repository: &Path,
    registered: &[status::registry::RegisteredCheckout],
) -> Result<Vec<LocalMergeDestinationView>, WorktreeChangesError> {
    let branches = git
        .run(
            &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
            repository,
        )
        .await?;
    if !branches.succeeded || branches.stdout_truncated || !branches.stdout_valid_utf8 {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not list local destination branches.",
        ));
    }
    Ok(branches
        .stdout
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(|branch| LocalMergeDestinationView {
            branch: branch.to_owned(),
            checkout: registered.iter().find_map(|entry| {
                (entry.branch.as_deref() == Some(branch))
                    .then(|| PathBuf::from(&entry.path).canonicalize().ok())
                    .flatten()
                    .filter(|path| path.is_dir())
                    .map(|path| path.display().to_string())
            }),
        })
        .collect())
}

pub(super) async fn in_progress(
    git: &GitPort,
    checkout: &Path,
) -> Result<bool, WorktreeChangesError> {
    for head in [
        "MERGE_HEAD",
        "REBASE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
    ] {
        if git
            .run(&["rev-parse", "--verify", "--quiet", head], checkout)
            .await?
            .succeeded
        {
            return Ok(true);
        }
    }
    for state_directory in ["rebase-merge", "rebase-apply"] {
        let path = git
            .run(&["rev-parse", "--git-path", state_directory], checkout)
            .await?;
        if path.succeeded && !path.stdout_truncated && path.stdout_valid_utf8 {
            let path = PathBuf::from(path.trimmed_stdout());
            let path = if path.is_absolute() {
                path
            } else {
                checkout.join(path)
            };
            if path.exists() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn is_oid(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
