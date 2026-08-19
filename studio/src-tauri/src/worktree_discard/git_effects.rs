//! What Git says about an indexed checkout, and the three commands that
//! remove it.
//!
//! Discard is the destructive seam, so the inspection here exists to make its
//! scope *smaller* than Git would allow. It answers two questions about the
//! exact recorded path and the exact recorded branch — is each still ours, and
//! is each still there? — and every effect below acts on one of those two
//! names alone. Nothing enumerates, globs, or sweeps.
//!
//! Three observations refuse the effect outright: a registration at our path
//! that holds another branch, a directory at our path that Git does not
//! register at all, and our branch checked out somewhere else. Each means the
//! path or the ref now belongs to another identity, and the operation reports
//! it rather than widening.
//!
//! Every invocation goes through the shared argument-vector port: a fixed
//! executable, an explicit working directory, no shell, and no caller text
//! interpolated into a command line.

use std::path::Path;

use crate::worktree_status::registry::{self, same_path};
use crate::worktree_status::GitPort;

use super::error::WorktreeDiscardError;

/// What the repository currently shows about the recorded checkout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CheckoutState {
    /// Registered at the recorded path on the recorded branch, with its
    /// directory still on disk. It is removed.
    Present,
    /// Registered at the recorded path on the recorded branch, but the
    /// directory is gone. Only the administrative entry survives, and pruning
    /// is the one step still owed.
    Stale,
    /// Neither a registration nor a directory. Removal is already complete.
    Absent,
    /// The path now belongs to something else. It is never removed.
    Foreign { code: String, detail: String },
}

/// What the repository currently shows about the recorded task branch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BranchState {
    /// The branch exists and is held by nothing but the recorded checkout.
    Present,
    /// The branch is already gone. Deletion is already complete.
    Absent,
    /// The branch is checked out somewhere other than the recorded path. It is
    /// never deleted.
    Foreign { code: String, detail: String },
}

/// The two answers a discard decides from, taken together under the
/// repository lock.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiscardObservation {
    pub(crate) checkout: CheckoutState,
    pub(crate) branch: BranchState,
}

impl DiscardObservation {
    /// The first reason, if any, this discard may not proceed.
    pub(crate) fn conflict(&self) -> Option<(&str, &str)> {
        match (&self.checkout, &self.branch) {
            (CheckoutState::Foreign { code, detail }, _)
            | (_, BranchState::Foreign { code, detail }) => Some((code, detail)),
            _ => None,
        }
    }

    /// True when the repository already holds none of what this discard would
    /// remove. The index row may still exist, which is why this is not on its
    /// own the end of the operation.
    pub(crate) fn settled(&self) -> bool {
        self.checkout == CheckoutState::Absent && self.branch == BranchState::Absent
    }
}

/// Inspect the repository for the recorded checkout and branch.
pub(crate) async fn observe(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
    branch: &str,
) -> Result<DiscardObservation, WorktreeDiscardError> {
    let registered = registry::checkouts(git, repository).await?;
    let ours = registered
        .iter()
        .find(|entry| same_path(&entry.path, checkout));

    let checkout_state = match ours {
        Some(entry) if entry.branch.as_deref() != Some(branch) => CheckoutState::Foreign {
            code: "worktree_path_registered_to_another_branch".to_owned(),
            detail: "The recorded checkout path is now a worktree on another branch.".to_owned(),
        },
        Some(_) if checkout.is_dir() => CheckoutState::Present,
        Some(_) => CheckoutState::Stale,
        None if checkout.exists() => CheckoutState::Foreign {
            code: "worktree_path_taken".to_owned(),
            detail: "Something that is not a worktree of this repository occupies the recorded path."
                .to_owned(),
        },
        None => CheckoutState::Absent,
    };

    let held_elsewhere = registered
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(branch) && !same_path(&entry.path, checkout));
    let branch_state = if held_elsewhere {
        BranchState::Foreign {
            code: "worktree_branch_checked_out_elsewhere".to_owned(),
            detail: "The task branch is checked out at another path.".to_owned(),
        }
    } else if registry::branch_exists(git, repository, branch).await? {
        BranchState::Present
    } else {
        BranchState::Absent
    };

    Ok(DiscardObservation {
        checkout: checkout_state,
        branch: branch_state,
    })
}

/// Remove the recorded checkout.
///
/// `--force` is part of the fixed argument vector rather than a caller-selected
/// scope: a discard throws the isolated work away by definition, which is what
/// Studio's confirmation confirms. It names one path — the one this repository
/// registers for this operation's own branch — so the force applies to that
/// checkout and nothing else.
pub(crate) async fn remove(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
) -> Result<(), WorktreeDiscardError> {
    let checkout = checkout.display().to_string();
    let removed = git
        .run(&["worktree", "remove", "--force", &checkout], repository)
        .await?;
    if !removed.succeeded {
        return Err(WorktreeDiscardError::git_failed(
            "Git refused to remove the task worktree.",
            removed.trimmed_stderr(),
        ));
    }
    Ok(())
}

/// Drop the administrative record of a checkout whose directory is gone.
///
/// `git worktree prune` is Git's only verb for this, and it is reached only
/// when *this* operation's own entry is the stale one. It removes registrations
/// whose checkouts have already disappeared and never touches a live tree, a
/// ref, or a file.
pub(crate) async fn prune(git: &GitPort, repository: &Path) -> Result<(), WorktreeDiscardError> {
    let pruned = git.run(&["worktree", "prune"], repository).await?;
    if !pruned.succeeded {
        return Err(WorktreeDiscardError::git_failed(
            "Git refused to prune the stale worktree record.",
            pruned.trimmed_stderr(),
        ));
    }
    Ok(())
}

/// Delete the recorded task branch.
///
/// `-D` rather than `-d` because unmerged commits are the expected state of a
/// discarded task; the branch named is the one the index recorded, and the
/// observation above has already refused to reach here when that branch is
/// held by another checkout.
pub(crate) async fn delete_branch(
    git: &GitPort,
    repository: &Path,
    branch: &str,
) -> Result<(), WorktreeDiscardError> {
    let deleted = git.run(&["branch", "-D", branch], repository).await?;
    if !deleted.succeeded {
        return Err(WorktreeDiscardError::git_failed(
            "Git refused to delete the task branch.",
            deleted.trimmed_stderr(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::worktree_create::test_support;

    /// A repository with one task checkout cut from its base commit.
    fn repository_with_checkout(directory: &Path) -> (PathBuf, PathBuf) {
        let repository = directory.join("repository");
        let base = test_support::repository(&repository);
        let checkout = directory.join("checkouts/CODIN-1-task");
        std::fs::create_dir_all(checkout.parent().expect("a parent")).expect("create the base");
        test_support::git(
            &[
                "worktree",
                "add",
                "-b",
                "wt/CODIN-1-task",
                &checkout.display().to_string(),
                &base,
            ],
            &repository,
        );
        (repository, checkout)
    }

    #[tokio::test]
    async fn a_live_checkout_and_its_branch_are_both_present() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let (repository, checkout) = repository_with_checkout(directory.path());

        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert_eq!(observation.checkout, CheckoutState::Present);
        assert_eq!(observation.branch, BranchState::Present);
        assert!(observation.conflict().is_none());
        assert!(!observation.settled());
    }

    #[tokio::test]
    async fn a_checkout_deleted_out_of_band_leaves_only_a_stale_record() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let (repository, checkout) = repository_with_checkout(directory.path());
        std::fs::remove_dir_all(&checkout).expect("remove the checkout out of band");

        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert_eq!(observation.checkout, CheckoutState::Stale);
        assert_eq!(observation.branch, BranchState::Present);
    }

    #[tokio::test]
    async fn an_already_discarded_worktree_shows_nothing_left_to_remove() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let (repository, checkout) = repository_with_checkout(directory.path());
        let git = GitPort::new();
        remove(&git, &repository, &checkout)
            .await
            .expect("remove the checkout");
        delete_branch(&git, &repository, "wt/CODIN-1-task")
            .await
            .expect("delete the branch");

        let observation = observe(&git, &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert!(observation.settled());
        assert!(observation.conflict().is_none());
    }

    #[tokio::test]
    async fn a_path_reused_for_another_branch_is_refused_rather_than_removed() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let (repository, checkout) = repository_with_checkout(directory.path());

        // The recorded path is now a checkout of an entirely different branch.
        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-9-other")
            .await
            .expect("inspect the repository");

        assert!(matches!(
            observation.conflict(),
            Some((code, _)) if code == "worktree_path_registered_to_another_branch"
        ));
    }

    #[tokio::test]
    async fn foreign_content_at_the_recorded_path_is_never_removed() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        test_support::repository(&repository);
        let checkout = directory.path().join("checkouts/CODIN-1-task");
        std::fs::create_dir_all(&checkout).expect("occupy the recorded path");

        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert!(matches!(
            observation.conflict(),
            Some((code, _)) if code == "worktree_path_taken"
        ));
    }

    #[tokio::test]
    async fn a_branch_checked_out_elsewhere_is_refused_rather_than_deleted() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let (repository, checkout) = repository_with_checkout(directory.path());
        // The checkout moves: the recorded path is gone, and the branch this
        // discard would delete is now held by a tree it does not own.
        let moved = directory.path().join("checkouts/moved");
        test_support::git(
            &[
                "worktree",
                "move",
                &checkout.display().to_string(),
                &moved.display().to_string(),
            ],
            &repository,
        );

        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert_eq!(observation.checkout, CheckoutState::Absent);
        assert!(matches!(
            observation.conflict(),
            Some((code, _)) if code == "worktree_branch_checked_out_elsewhere"
        ));
    }
}
