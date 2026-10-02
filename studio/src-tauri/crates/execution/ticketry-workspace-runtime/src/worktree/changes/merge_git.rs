use crate::worktree::status::{self, WorktreeStatusService};

use super::WorktreeChangesError;

pub(super) async fn is_ancestor(
    status: &WorktreeStatusService,
    ancestor: &str,
    descendant: &str,
    repository: &std::path::Path,
) -> Result<bool, WorktreeChangesError> {
    Ok(status
        .git()
        .run(
            &["merge-base", "--is-ancestor", ancestor, descendant],
            repository,
        )
        .await?
        .succeeded)
}

pub(super) async fn git_ref(
    git: &status::GitPort,
    checkout: &std::path::Path,
    name: &str,
) -> Result<Option<String>, WorktreeChangesError> {
    let outcome = git
        .run(&["rev-parse", "--verify", "--quiet", name], checkout)
        .await?;
    Ok(outcome
        .succeeded
        .then(|| outcome.trimmed_stdout().to_owned()))
}

pub(super) async fn unmerged_paths(
    git: &status::GitPort,
    checkout: &std::path::Path,
) -> Result<Vec<String>, WorktreeChangesError> {
    let outcome = git
        .run(&["diff", "--name-only", "--diff-filter=U", "-z"], checkout)
        .await?;
    if !outcome.succeeded || outcome.stdout_truncated || !outcome.stdout_valid_utf8 {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not list the merge's unresolved paths.",
        ));
    }
    Ok(outcome
        .stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect())
}
