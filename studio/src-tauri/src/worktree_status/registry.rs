//! Which checkouts a repository currently registers.
//!
//! `git worktree list --porcelain` is the authoritative answer to "does this
//! repository know about that tree?". A directory on disk that Git does not
//! register is not a worktree, and a registration whose directory is gone is
//! still an administrative record Git owns. Every worktree capability —
//! status, creation, discard — decides what it may touch from this one read,
//! so they cannot disagree about what exists.

use std::path::Path;

use super::error::WorktreeStatusError;
use super::git::GitPort;

/// One entry of the repository's worktree registry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RegisteredCheckout {
    pub(crate) path: String,
    pub(crate) branch: Option<String>,
}

/// Every checkout Git currently tracks for this repository, with the branch
/// each one holds.
pub(crate) async fn checkouts(
    git: &GitPort,
    repository: &Path,
) -> Result<Vec<RegisteredCheckout>, WorktreeStatusError> {
    let listed = git
        .run(&["worktree", "list", "--porcelain"], repository)
        .await?;
    if !listed.succeeded {
        return Err(WorktreeStatusError::git_unavailable(
            "The repository's worktree registry could not be read.",
        ));
    }
    let mut checkouts = Vec::new();
    for line in listed.stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            checkouts.push(RegisteredCheckout {
                path: path.trim().to_owned(),
                branch: None,
            });
        } else if let Some(reference) = line.strip_prefix("branch ") {
            if let Some(current) = checkouts.last_mut() {
                current.branch = Some(
                    reference
                        .trim()
                        .strip_prefix("refs/heads/")
                        .unwrap_or(reference.trim())
                        .to_owned(),
                );
            }
        }
    }
    Ok(checkouts)
}

/// Whether a local branch exists in this repository.
pub(crate) async fn branch_exists(
    git: &GitPort,
    repository: &Path,
    branch: &str,
) -> Result<bool, WorktreeStatusError> {
    let reference = format!("refs/heads/{branch}");
    Ok(git
        .run(
            &["rev-parse", "--verify", "--quiet", &reference],
            repository,
        )
        .await?
        .succeeded)
}

/// Compare two checkout paths as the filesystem resolves them, so a symlinked
/// or differently-spelled base directory is still recognised as the same tree.
///
/// A checkout that has been deleted out of band still has to be recognised —
/// that is exactly the case where Git holds a stale administrative record for
/// it — so resolution falls back to the deepest ancestor that does exist.
pub(crate) fn same_path(registered: &str, checkout: &Path) -> bool {
    let registered = Path::new(registered);
    registered == checkout || resolved(registered) == resolved(checkout)
}

fn resolved(path: &Path) -> std::path::PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => resolved(parent).join(name),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_checkout_deleted_out_of_band_is_still_recognised_as_its_own_path() {
        let directory = tempfile::tempdir().expect("create a base directory");
        let missing = directory.path().join("checkouts/CODIN-1-task");

        // The base resolves through whatever symlinks the platform uses; the
        // absent leaf is compared by name under it.
        assert!(same_path(
            &directory
                .path()
                .canonicalize()
                .expect("canonicalize the base")
                .join("checkouts/CODIN-1-task")
                .display()
                .to_string(),
            &missing
        ));
        assert!(!same_path(
            &directory
                .path()
                .join("checkouts/other")
                .display()
                .to_string(),
            &missing
        ));
    }
}
