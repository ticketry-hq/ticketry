use std::path::{Path, PathBuf};

use crate::worktree::status::{self, GitPort};

use super::WorktreeChangesError;

pub(super) fn recorded_paths(
    repository: &str,
    checkout: &str,
) -> Result<(PathBuf, PathBuf), WorktreeChangesError> {
    let repository = recorded_repository(repository)?;
    let checkout = PathBuf::from(checkout);
    if !checkout.is_absolute() {
        return Err(WorktreeChangesError::invalid_path());
    }
    let checkout = checkout
        .canonicalize()
        .map_err(|_| WorktreeChangesError::checkout_missing())?;
    if !checkout.is_dir() {
        return Err(WorktreeChangesError::checkout_missing());
    }
    Ok((repository, checkout))
}

pub(super) fn recorded_repository(repository: &str) -> Result<PathBuf, WorktreeChangesError> {
    let repository = PathBuf::from(repository);
    if !repository.is_absolute() {
        return Err(WorktreeChangesError::invalid_path());
    }
    let repository = repository
        .canonicalize()
        .map_err(|_| WorktreeChangesError::repository_missing())?;
    if !repository.is_dir() {
        return Err(WorktreeChangesError::repository_missing());
    }
    Ok(repository)
}

pub(super) async fn validate_membership(
    git: &GitPort,
    repository: &Path,
    checkout: &Path,
) -> Result<(), WorktreeChangesError> {
    let repository_top = git
        .run(&["rev-parse", "--show-toplevel"], repository)
        .await?;
    if !repository_top.succeeded {
        return Err(WorktreeChangesError::repository_missing());
    }
    validate_git_path(&repository_top.stdout, repository)?;

    let checkout_top = git.run(&["rev-parse", "--show-toplevel"], checkout).await?;
    if !checkout_top.succeeded || !checkout_top.stdout_valid_utf8 {
        return Err(WorktreeChangesError::invalid_path());
    }
    validate_git_path(&checkout_top.stdout, checkout)?;

    let registered = status::registry::checkouts(git, repository).await?;
    if !registered
        .iter()
        .any(|entry| status::registry::same_path(&entry.path, checkout))
    {
        return Err(WorktreeChangesError::invalid_path());
    }
    Ok(())
}

fn validate_git_path(raw: &str, expected: &Path) -> Result<(), WorktreeChangesError> {
    let actual = PathBuf::from(raw.trim());
    let actual = actual
        .canonicalize()
        .map_err(|_| WorktreeChangesError::invalid_path())?;
    if actual == expected {
        Ok(())
    } else {
        Err(WorktreeChangesError::invalid_path())
    }
}
