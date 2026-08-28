//! From the selected profile to a canonical repository.
//!
//! A worktree can only exist inside the repository that encloses the module's
//! configured local folder. Every step of that resolution can legitimately be
//! missing — no profile is selected, the module has no link, the folder was
//! moved, the folder is not in Git — and each of those is ordinary data rather
//! than a failure.
//!
//! What must never happen is a fallback. If the folder cannot be resolved, no
//! Git command runs at all, so a status read can never silently describe
//! whatever repository the process happens to be standing in.

use std::path::{Path, PathBuf};

use crate::settings_persistence::ProfileStore;

use super::error::WorktreeStatusError;
use super::git::GitPort;
use super::identity::compact_uuid;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RepositoryResolution {
    /// The canonical toplevel of the repository enclosing the module folder.
    Repository(PathBuf),
    /// No repository can enclose this Work Item, with the reason a caller may
    /// show verbatim.
    NoRepository(&'static str),
}

pub(crate) async fn resolve(
    profiles: &ProfileStore,
    git: &GitPort,
    module_id: Option<&str>,
) -> Result<RepositoryResolution, WorktreeStatusError> {
    let Some(module_id) = module_id else {
        return Ok(RepositoryResolution::NoRepository(
            "this Work Item has no module to resolve a local folder from",
        ));
    };
    let Some(folder) = module_folder(profiles, module_id) else {
        return Ok(RepositoryResolution::NoRepository(
            "no local folder is configured for this module",
        ));
    };
    if !folder.is_dir() {
        return Ok(RepositoryResolution::NoRepository(
            "the local folder configured for this module is not available",
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

/// The selected profile's folder for one module. Only the selected profile is
/// consulted, because that is the profile whose folders the rest of Ticketry
/// launches and reads against.
///
/// Shared with [`crate::launch::paths`], so a run and a worktree can never
/// disagree about which folder a module is configured against.
pub(crate) fn module_folder(profiles: &ProfileStore, module_id: &str) -> Option<PathBuf> {
    let catalog = profiles.read();
    let index = usize::try_from(catalog.recent_profile_index.unwrap_or(0)).ok()?;
    let profile = catalog.profiles.get(index)?;
    profile
        .module_links
        .iter()
        .rev()
        .find(|link| compact_uuid(&link.module_id) == compact_uuid(module_id))
        .map(|link| link.path.trim().to_owned())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use crate::settings_persistence::{ModuleLink, Profile, ProfileCatalog};

    use super::*;

    fn store(directory: &Path, links: Vec<ModuleLink>) -> ProfileStore {
        let store = ProfileStore::new(directory.join("profiles.json"));
        store
            .replace(&ProfileCatalog {
                recent_profile_index: Some(0),
                profiles: vec![Profile {
                    name: "Local".to_owned(),
                    workspace_slug: "meml".to_owned(),
                    agent_prompt: None,
                    agent_prompts: Default::default(),
                    module_links: links,
                    recent_project_id: None,
                    recent_module_ids: Default::default(),
                }],
            })
            .expect("write the profile catalog");
        store
    }

    #[tokio::test]
    async fn an_unconfigured_module_is_normal_data_and_runs_no_git() {
        let directory = tempfile::tempdir().expect("create a settings directory");
        let profiles = store(directory.path(), Vec::new());

        let resolution = resolve(
            &profiles,
            &GitPort::new(),
            Some("00000000-0000-0000-0000-0000000002c1"),
        )
        .await
        .expect("resolution reports data rather than failing");

        assert_eq!(
            resolution,
            RepositoryResolution::NoRepository("no local folder is configured for this module")
        );
    }

    #[tokio::test]
    async fn a_configured_folder_that_moved_never_falls_back_to_another_directory() {
        let directory = tempfile::tempdir().expect("create a settings directory");
        let profiles = store(
            directory.path(),
            vec![ModuleLink {
                module_id: "00000000-0000-0000-0000-0000000002c1".to_owned(),
                path: directory
                    .path()
                    .join("missing-checkout")
                    .display()
                    .to_string(),
            }],
        );

        let resolution = resolve(
            &profiles,
            &GitPort::new(),
            Some("00000000-0000-0000-0000-0000000002c1"),
        )
        .await
        .expect("resolution reports data rather than failing");

        assert_eq!(
            resolution,
            RepositoryResolution::NoRepository(
                "the local folder configured for this module is not available"
            )
        );
    }
}
