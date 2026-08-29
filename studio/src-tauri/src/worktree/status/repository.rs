//! From the Module's typed link to a canonical repository.
//!
//! A worktree can only exist inside the repository that encloses the folder
//! the Module is linked to. Every step of that resolution can legitimately be
//! missing — the Work Item has no module, the module has no link, the folder
//! was moved, the folder is not in Git — and each of those is ordinary data
//! rather than a failure.
//!
//! What must never happen is a fallback. If the folder cannot be resolved, no
//! Git command runs at all, so a status read can never silently describe
//! whatever repository the process happens to be standing in.

use std::path::{Path, PathBuf};

use sea_orm::DatabaseConnection;

use super::error::WorktreeStatusError;
use super::git::GitPort;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RepositoryResolution {
    /// The canonical toplevel of the repository enclosing the module folder.
    Repository(PathBuf),
    /// No repository can enclose this Work Item, with the reason a caller may
    /// show verbatim.
    NoRepository(&'static str),
}

pub(crate) async fn resolve(
    database: &DatabaseConnection,
    git: &GitPort,
    module_id: Option<&str>,
) -> Result<RepositoryResolution, WorktreeStatusError> {
    let Some(module_id) = module_id else {
        return Ok(RepositoryResolution::NoRepository(
            "this Work Item has no module to resolve a local folder from",
        ));
    };
    let Some(folder) = module_folder(database, module_id).await else {
        return Ok(RepositoryResolution::NoRepository(
            "no local folder is linked to this module",
        ));
    };
    if !folder.is_dir() {
        return Ok(RepositoryResolution::NoRepository(
            "the local folder linked to this module is not available",
        ));
    }
    discover(git, &folder).await
}

/// The repository enclosing an existing directory, canonicalized so one
/// repository has exactly one lock key regardless of how it was reached.
pub(crate) async fn discover(
    git: &GitPort,
    folder: &Path,
) -> Result<RepositoryResolution, WorktreeStatusError> {
    let toplevel = git.run(&["rev-parse", "--show-toplevel"], folder).await?;
    if !toplevel.succeeded || toplevel.trimmed_stdout().is_empty() {
        return Ok(RepositoryResolution::NoRepository(
            "no git repository encloses this module folder",
        ));
    }
    let root = PathBuf::from(toplevel.trimmed_stdout());
    Ok(RepositoryResolution::Repository(
        root.canonicalize().unwrap_or(root),
    ))
}

/// The folder one Module is linked to, as recorded on its typed link.
///
/// The link is the only source. No profile is consulted and no selection
/// index is involved, so a run, a worktree, and a design directory can never
/// disagree about which folder a Module is checked out into.
///
/// Shared with [`crate::launch::paths`] through
/// [`crate::module_links::resolution`].
pub(crate) async fn module_folder(
    database: &DatabaseConnection,
    module_id: &str,
) -> Option<PathBuf> {
    crate::module_links::resolution::linked_folder(database, module_id)
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use crate::module_links::test_support;

    use super::*;

    const MODULE: &str = "00000000-0000-0000-0000-0000000002c1";

    /// An installation that knows one Module.
    async fn installation() -> DatabaseConnection {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open an in-memory installation");
        test_support::install(&database).await;
        test_support::module(&database, MODULE, "Studio").await;
        database
    }

    #[tokio::test]
    async fn an_unlinked_module_is_normal_data_and_runs_no_git() {
        let database = installation().await;

        let resolution = resolve(&database, &GitPort::new(), Some(MODULE))
            .await
            .expect("resolution reports data rather than failing");

        assert_eq!(
            resolution,
            RepositoryResolution::NoRepository("no local folder is linked to this module")
        );
    }

    #[tokio::test]
    async fn a_linked_folder_that_moved_never_falls_back_to_another_directory() {
        let directory = tempfile::tempdir().expect("create a fixture root");
        let database = installation().await;
        test_support::link(
            &database,
            MODULE,
            &directory.path().join("missing-checkout").display().to_string(),
        )
        .await;

        let resolution = resolve(&database, &GitPort::new(), Some(MODULE))
            .await
            .expect("resolution reports data rather than failing");

        assert_eq!(
            resolution,
            RepositoryResolution::NoRepository(
                "the local folder linked to this module is not available"
            )
        );
    }

    #[tokio::test]
    async fn either_identity_spelling_resolves_the_same_link() {
        let directory = tempfile::tempdir().expect("create a fixture root");
        let database = installation().await;
        test_support::link(&database, MODULE, &directory.path().display().to_string()).await;

        assert_eq!(
            module_folder(&database, MODULE).await,
            module_folder(&database, "000000000000000000000000000002c1").await
        );
        assert_eq!(
            module_folder(&database, MODULE).await,
            Some(PathBuf::from(directory.path()))
        );
    }
}
