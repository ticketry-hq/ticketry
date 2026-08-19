//! What Git can prove about a landing, and the four commands that perform one.
//!
//! Every invocation goes through the shared argument-vector port: a fixed
//! executable, an explicit working directory, no shell, and no caller text
//! interpolated into a command line. Output is bounded by the port before it
//! can become an error or durable evidence.
//!
//! The reason this module is mostly *questions* is that an integration is a
//! sequence of external effects with no transaction around it. A restart may
//! land anywhere inside that sequence, so each step must be recognisable after
//! the fact from the repository alone. Ancestry is what makes that possible:
//! "the base is already contained in the branch" is the merge, and "the branch
//! is already contained in the base" is the ref advance. Both are cheap, exact,
//! and — unlike a missing directory or a missing row — impossible to fake by
//! deleting something.

use std::path::Path;

use crate::worktree_status::GitPort;

use super::error::WorktreeIntegrateError;

/// The result of merging the recorded base into the isolated checkout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum MergeOutcome {
    /// The branch now contains the base. Its tip is the landed commit.
    Merged { tip: String },
    /// Git stopped with unmerged paths. The checkout keeps the half-finished
    /// merge for a person to resolve; the primary checkout is untouched.
    Stopped { detail: String },
    /// The merge refused for some other reason, leaving no unmerged paths.
    Refused { detail: String },
}

/// Where Git registers a checkout path, if it registers it at all.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Registration {
    /// Git tracks this path as a worktree holding the expected branch.
    Matching,
    /// Git tracks this path, but on some other branch, or detached.
    Foreign { branch: Option<String> },
    /// Git does not track this path as a worktree of this repository.
    Absent,
}

/// The commit one ref resolves to, or `None` when no such ref exists.
///
/// `--verify --quiet` keeps "there is no such ref" an ordinary answer, which
/// matters: a recorded base that has been deleted, and a task branch that has
/// already been deleted, are both boundaries rather than failures.
pub(crate) async fn commit_at(
    git: &GitPort,
    directory: &Path,
    reference: &str,
) -> Result<Option<String>, WorktreeIntegrateError> {
    let revision = format!("{reference}^{{commit}}");
    let resolved = git
        .run(&["rev-parse", "--verify", "--quiet", &revision], directory)
        .await?;
    if !resolved.succeeded || resolved.trimmed_stdout().is_empty() {
        return Ok(None);
    }
    Ok(Some(resolved.trimmed_stdout().to_owned()))
}

/// The commit a local branch points at. Branch refs are asked for by their
/// full name so a tag or a remote-tracking ref of the same name can never be
/// mistaken for the branch this operation owns.
pub(crate) async fn branch_tip(
    git: &GitPort,
    repository: &Path,
    branch: &str,
) -> Result<Option<String>, WorktreeIntegrateError> {
    commit_at(git, repository, &format!("refs/heads/{branch}")).await
}

/// Whether `ancestor` is contained in `descendant`'s history. This is the
/// whole proof system: it answers "has the merge happened" and "has the ref
/// advanced" without trusting anything that was written down.
pub(crate) async fn contains(
    git: &GitPort,
    repository: &Path,
    ancestor: &str,
    descendant: &str,
) -> Result<bool, WorktreeIntegrateError> {
    Ok(git
        .run(
            &["merge-base", "--is-ancestor", ancestor, descendant],
            repository,
        )
        .await?
        .succeeded)
}

/// The branch the primary checkout currently holds, or `None` when its HEAD is
/// detached.
pub(crate) async fn head_branch(
    git: &GitPort,
    repository: &Path,
) -> Result<Option<String>, WorktreeIntegrateError> {
    let named = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"], repository)
        .await?;
    if !named.succeeded || named.trimmed_stdout().is_empty() {
        return Ok(None);
    }
    Ok(Some(named.trimmed_stdout().to_owned()))
}

/// Whether Git registers this exact path as a worktree on this exact branch.
pub(crate) async fn registration(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
    branch: &str,
) -> Result<Registration, WorktreeIntegrateError> {
    let listed = git
        .run(&["worktree", "list", "--porcelain"], repository)
        .await?;
    if !listed.succeeded {
        return Err(WorktreeIntegrateError::git_failed(
            "The repository's worktree registry could not be read.",
            listed.trimmed_stderr(),
        ));
    }
    let mut entries: Vec<(String, Option<String>)> = Vec::new();
    for line in listed.stdout.lines() {
        if let Some(entry) = line.strip_prefix("worktree ") {
            entries.push((entry.trim().to_owned(), None));
        } else if let Some(reference) = line.strip_prefix("branch ") {
            if let Some(current) = entries.last_mut() {
                current.1 = Some(
                    reference
                        .trim()
                        .strip_prefix("refs/heads/")
                        .unwrap_or(reference.trim())
                        .to_owned(),
                );
            }
        }
    }
    let Some((_, held)) = entries
        .into_iter()
        .find(|(path, _)| same_path(path, checkout))
    else {
        return Ok(Registration::Absent);
    };
    if held.as_deref() == Some(branch) {
        return Ok(Registration::Matching);
    }
    Ok(Registration::Foreign { branch: held })
}

/// Whether the checkout holds uncommitted work. Unmerged paths from a stopped
/// merge show here too, which is why the dirty guard also protects a conflict
/// that has not been resolved yet.
pub(crate) async fn dirty(git: &GitPort, checkout: &Path) -> Result<bool, WorktreeIntegrateError> {
    let porcelain = git.run(&["status", "--porcelain"], checkout).await?;
    if !porcelain.succeeded {
        return Err(WorktreeIntegrateError::git_failed(
            "The task checkout could not be inspected.",
            porcelain.trimmed_stderr(),
        ));
    }
    Ok(!porcelain.trimmed_stdout().is_empty())
}

/// Merge the recorded base into the isolated checkout.
///
/// This is the only mutation of a working tree an integration performs, and it
/// happens inside the task checkout — never the primary one — so a conflict is
/// contained where the person who has to resolve it already works.
pub(crate) async fn merge_base(
    git: &GitPort,
    checkout: &Path,
    base_ref: &str,
) -> Result<MergeOutcome, WorktreeIntegrateError> {
    let merged = git.run(&["merge", "--no-edit", base_ref], checkout).await?;
    if !merged.succeeded {
        let unmerged = git
            .run(&["diff", "--name-only", "--diff-filter=U"], checkout)
            .await?;
        let detail = merged.trimmed_stderr().to_owned();
        return Ok(if !unmerged.trimmed_stdout().is_empty() {
            MergeOutcome::Stopped { detail }
        } else {
            MergeOutcome::Refused { detail }
        });
    }
    let tip = commit_at(git, checkout, "HEAD").await?.ok_or_else(|| {
        WorktreeIntegrateError::git_failed("The merged checkout has no readable HEAD.", "")
    })?;
    Ok(MergeOutcome::Merged { tip })
}

/// Advance the recorded base to the merged task branch.
///
/// Two shapes, both of which can only move the base *forward*: a fast-forward
/// when the base is the primary checkout's branch, and an exact ref move when
/// it is not. Neither can create a merge commit, and neither is reached unless
/// ancestry already proved the branch contains the base.
pub(crate) async fn advance_base(
    git: &GitPort,
    repository: &Path,
    base_ref: &str,
    branch: &str,
    base_checked_out: bool,
) -> Result<(), WorktreeIntegrateError> {
    let advanced = if base_checked_out {
        git.run(&["merge", "--ff-only", branch], repository).await?
    } else {
        git.run(&["branch", "-f", base_ref, branch], repository)
            .await?
    };
    if !advanced.succeeded {
        return Err(WorktreeIntegrateError::git_failed(
            "Git refused to advance the recorded base to the landed branch.",
            advanced.trimmed_stderr(),
        ));
    }
    Ok(())
}

/// Remove the landed checkout. It is never forced: by this point the tree is
/// clean and fully merged, so a refusal is information rather than an obstacle.
pub(crate) async fn remove_checkout(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
) -> Result<(), WorktreeIntegrateError> {
    let checkout = checkout.display().to_string();
    let removed = git
        .run(&["worktree", "remove", &checkout], repository)
        .await?;
    if !removed.succeeded {
        return Err(WorktreeIntegrateError::git_failed(
            "Git refused to remove the landed checkout.",
            removed.trimmed_stderr(),
        ));
    }
    Ok(())
}

/// Drop the administrative record of a checkout whose directory is already
/// gone. It prunes only records Git itself considers stale, so a live checkout
/// — including another Work Item's — is never touched.
pub(crate) async fn prune(git: &GitPort, repository: &Path) -> Result<(), WorktreeIntegrateError> {
    git.run(&["worktree", "prune"], repository).await?;
    Ok(())
}

/// Delete the landed task branch.
///
/// `-d` is used when the base is the primary checkout's branch, because then
/// Git's own merged check is a real second opinion. Otherwise HEAD is some
/// unrelated branch and `-d` would refuse for the wrong reason, so `-D` is used
/// — but only after ancestry proved the base already contains this branch.
pub(crate) async fn delete_branch(
    git: &GitPort,
    repository: &Path,
    branch: &str,
    base_checked_out: bool,
) -> Result<(), WorktreeIntegrateError> {
    let flag = if base_checked_out { "-d" } else { "-D" };
    let deleted = git.run(&["branch", flag, branch], repository).await?;
    if !deleted.succeeded {
        return Err(WorktreeIntegrateError::git_failed(
            "Git refused to delete the landed task branch.",
            deleted.trimmed_stderr(),
        ));
    }
    Ok(())
}

fn same_path(registered: &str, checkout: &Path) -> bool {
    let registered = Path::new(registered);
    registered == checkout
        || matches!(
            (registered.canonicalize(), checkout.canonicalize()),
            (Ok(one), Ok(two)) if one == two
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository(root: &Path) -> String {
        crate::worktree_create::test_support::repository(root)
    }

    fn git_command(arguments: &[&str], directory: &Path) -> String {
        crate::worktree_create::test_support::git(arguments, directory)
    }

    #[tokio::test]
    async fn ancestry_is_what_proves_a_merge_and_a_ref_advance() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository_root = directory.path().join("repository");
        let base = repository(&repository_root);
        git_command(&["branch", "wt/task"], &repository_root);
        let git = GitPort::new();

        // Nothing has diverged yet, so each contains the other.
        assert!(contains(&git, &repository_root, &base, "wt/task")
            .await
            .expect("ask about ancestry"));
        assert_eq!(
            branch_tip(&git, &repository_root, "wt/task")
                .await
                .expect("read the branch tip"),
            Some(base.clone())
        );
        assert_eq!(
            branch_tip(&git, &repository_root, "wt/missing")
                .await
                .expect("read a missing branch"),
            None
        );
        assert_eq!(
            head_branch(&git, &repository_root)
                .await
                .expect("read the primary head"),
            Some("main".to_owned())
        );
    }

    #[tokio::test]
    async fn a_path_git_does_not_track_is_absent_rather_than_foreign() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository_root = directory.path().join("repository");
        repository(&repository_root);

        assert_eq!(
            registration(
                &GitPort::new(),
                &repository_root,
                &directory.path().join("checkouts/CODIN-1"),
                "wt/CODIN-1",
            )
            .await
            .expect("read the registry"),
            Registration::Absent
        );
    }
}
