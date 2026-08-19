//! What Git says about a checkout that may or may not exist yet, and the one
//! command that creates it.
//!
//! Every invocation goes through the shared argument-vector port: a fixed
//! executable, an explicit working directory, no shell, and no caller text
//! interpolated into a command line. Output is bounded by the port before it
//! can become an error or durable evidence.
//!
//! The inspection here is what makes creation safe to repeat. It answers one
//! question — *does the exact intended checkout already exist, does something
//! else hold its path or branch, or is the way clear?* — and creation acts
//! only on the last of those three answers.

use std::path::Path;

use crate::worktree_status::registry::{self, same_path};
use crate::worktree_status::GitPort;

use super::error::WorktreeCreateError;

/// What the repository currently shows about the intended checkout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CheckoutObservation {
    /// The exact intended checkout exists: registered at the expected path,
    /// on the expected branch. Its tip is the base a row would record.
    Matching { head_commit: String },
    /// Neither the path nor the branch is taken. Creation may proceed.
    Clear,
    /// Something else holds the path, the branch, or the registration. It is
    /// never removed, reset, or adopted.
    Conflicting { code: String, detail: String },
}

/// The committed HEAD a new checkout is cut from, and the base it integrates
/// back into. A detached HEAD records the commit itself as the base, so
/// creation stays defined without a named branch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RepositoryHead {
    pub(crate) commit: String,
    pub(crate) base_ref: String,
}

pub(crate) async fn head(
    git: &GitPort,
    repository: &Path,
) -> Result<RepositoryHead, WorktreeCreateError> {
    let commit = git.run(&["rev-parse", "HEAD"], repository).await?;
    if !commit.succeeded || commit.trimmed_stdout().is_empty() {
        return Err(WorktreeCreateError::git_failed(
            "The repository has no committed HEAD to cut a worktree from.",
            commit.trimmed_stderr(),
        ));
    }
    let commit = commit.trimmed_stdout().to_owned();
    let named = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"], repository)
        .await?;
    let base_ref = if named.succeeded && !named.trimmed_stdout().is_empty() {
        named.trimmed_stdout().to_owned()
    } else {
        commit.clone()
    };
    Ok(RepositoryHead { commit, base_ref })
}

/// Inspect the repository for the intended checkout and branch.
pub(crate) async fn observe(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
    branch: &str,
) -> Result<CheckoutObservation, WorktreeCreateError> {
    let registered = registry::checkouts(git, repository).await?;
    let registration = registered
        .iter()
        .find(|entry| same_path(&entry.path, checkout));

    if let Some(registration) = registration {
        if registration.branch.as_deref() != Some(branch) {
            return Ok(conflicting(
                "worktree_path_registered_to_another_branch",
                "The intended checkout path is already a worktree of this repository on another branch.",
            ));
        }
        if !checkout.is_dir() {
            return Ok(conflicting(
                "worktree_checkout_missing",
                "Git registers the intended checkout but its directory is gone.",
            ));
        }
        let head = git.run(&["rev-parse", "HEAD"], checkout).await?;
        if !head.succeeded || head.trimmed_stdout().is_empty() {
            return Ok(conflicting(
                "worktree_checkout_unreadable",
                "The intended checkout exists but Git cannot read its HEAD.",
            ));
        }
        return Ok(CheckoutObservation::Matching {
            head_commit: head.trimmed_stdout().to_owned(),
        });
    }

    if checkout.exists() {
        return Ok(conflicting(
            "worktree_path_taken",
            "Something already occupies the intended checkout path.",
        ));
    }
    if registered
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(branch))
    {
        return Ok(conflicting(
            "worktree_branch_checked_out_elsewhere",
            "The task branch is already checked out at another path.",
        ));
    }
    if registry::branch_exists(git, repository, branch).await? {
        return Ok(conflicting(
            "worktree_branch_exists",
            "The task branch already exists in this repository.",
        ));
    }
    Ok(CheckoutObservation::Clear)
}

/// Create the checkout: one branch, cut from the committed HEAD, in one
/// command. Uncommitted changes in the primary checkout are deliberately not
/// carried over, because the commit — not the working tree — is the base.
pub(crate) async fn create(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
    branch: &str,
    base_commit: &str,
) -> Result<(), WorktreeCreateError> {
    if let Some(parent) = checkout.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WorktreeCreateError::git_failed(
                "The checkout directory could not be prepared.",
                &error.to_string(),
            )
        })?;
    }
    let checkout = checkout.display().to_string();
    let added = git
        .run(
            &["worktree", "add", "-b", branch, &checkout, base_commit],
            repository,
        )
        .await?;
    if !added.succeeded {
        return Err(WorktreeCreateError::git_failed(
            "Git refused to create the task worktree.",
            added.trimmed_stderr(),
        ));
    }
    Ok(())
}

/// Prove the created checkout is exactly what was intended before anything is
/// written to the database.
pub(crate) async fn verify(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
    branch: &str,
) -> Result<String, WorktreeCreateError> {
    match observe(git, repository, checkout, branch).await? {
        CheckoutObservation::Matching { head_commit } => Ok(head_commit),
        CheckoutObservation::Clear => Err(WorktreeCreateError::git_failed(
            "Git reported success but the task worktree is not registered.",
            "",
        )),
        CheckoutObservation::Conflicting { detail, .. } => Err(WorktreeCreateError::git_failed(
            "The created worktree is not the intended one.",
            &detail,
        )),
    }
}

fn conflicting(code: &str, detail: &str) -> CheckoutObservation {
    CheckoutObservation::Conflicting {
        code: code.to_owned(),
        detail: detail.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_repository_without_the_checkout_or_branch_is_clear() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        crate::worktree_create::test_support::repository(&repository);

        let observation = observe(
            &GitPort::new(),
            &repository,
            &directory.path().join("checkouts/CODIN-1-task"),
            "wt/CODIN-1-task",
        )
        .await
        .expect("inspect the repository");

        assert_eq!(observation, CheckoutObservation::Clear);
    }

    #[tokio::test]
    async fn an_occupied_path_is_a_conflict_rather_than_a_creation() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        crate::worktree_create::test_support::repository(&repository);
        let checkout = directory.path().join("checkouts/CODIN-1-task");
        std::fs::create_dir_all(&checkout).expect("occupy the checkout path");

        let observation = observe(&GitPort::new(), &repository, &checkout, "wt/CODIN-1-task")
            .await
            .expect("inspect the repository");

        assert!(matches!(
            observation,
            CheckoutObservation::Conflicting { ref code, .. } if code == "worktree_path_taken"
        ));
    }

    #[tokio::test]
    async fn an_existing_branch_is_never_reused_for_a_new_checkout() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        crate::worktree_create::test_support::repository(&repository);
        crate::worktree_create::test_support::git(&["branch", "wt/CODIN-1-task"], &repository);

        let observation = observe(
            &GitPort::new(),
            &repository,
            &directory.path().join("checkouts/CODIN-1-task"),
            "wt/CODIN-1-task",
        )
        .await
        .expect("inspect the repository");

        assert!(matches!(
            observation,
            CheckoutObservation::Conflicting { ref code, .. } if code == "worktree_branch_exists"
        ));
    }

    #[tokio::test]
    async fn creation_is_recognised_as_the_exact_intended_checkout() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        let base = crate::worktree_create::test_support::repository(&repository);
        let checkout = directory.path().join("checkouts/CODIN-1-task");
        let git = GitPort::new();

        create(&git, &repository, &checkout, "wt/CODIN-1-task", &base)
            .await
            .expect("create the checkout");

        assert_eq!(
            verify(&git, &repository, &checkout, "wt/CODIN-1-task")
                .await
                .expect("verify the checkout"),
            base
        );
    }

    #[tokio::test]
    async fn a_detached_head_records_its_commit_as_the_base() {
        let directory = tempfile::tempdir().expect("create a repository directory");
        let repository = directory.path().join("repository");
        let base = crate::worktree_create::test_support::repository(&repository);
        crate::worktree_create::test_support::git(&["checkout", "--detach"], &repository);

        let head = head(&GitPort::new(), &repository)
            .await
            .expect("read the detached HEAD");

        assert_eq!(head.commit, base);
        assert_eq!(head.base_ref, base);
    }
}
