//! The one place a run's directories are decided.
//!
//! Resolution order is the same one the terminal capability has always used,
//! moved behind an identity-only boundary:
//!
//! 1. Derive the owning Work Item, and with it the module. A child resolves up
//!    to its top-level parent; a module can never be a launch owner.
//! 2. For a task run, use the owner's worktree if the index has one in
//!    `active` or `conflict` and the checkout is still on disk. Anything else
//!    — no row, a removed checkout, an unexpected state — falls back to the
//!    module folder, which is what the launch used before worktrees existed.
//! 3. Root the design directory at whichever of those two won, so generated
//!    documents ride the branch when the run is isolated and land in the
//!    module folder when it is not.
//! 4. Materialize that derived directory, and nothing else.
//!
//! Planning and instant runs skip step 2 entirely: they are module-scoped, so
//! there is no Work Item to own a checkout, and a launch never mints one.

use std::path::{Path, PathBuf};

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::documents::design_directory::{self, ModuleIdentity, TaskIdentity, SPEC_ROOT};
use crate::entities::documents::design_document;
use crate::entities::work_management::issue;
use crate::entities::worktrees::worktree;
use crate::settings_persistence::ProfileStore;
use crate::worktree::status::identity::{canonical_uuid, compact_uuid};
use crate::worktree::status::owner::{self, WorktreeOwner};
use crate::worktree::status::repository::module_folder;

use super::error::{LaunchPathsError, LaunchPathsErrorCode};
use super::request::{LaunchPathsRequest, LaunchScope, SUPPORTED_VERSION};
use super::view::{LaunchPathsView, WorktreeUse, WORKTREE_CHECKOUT_MISSING, WORKTREE_NONE};

/// The lifecycle states whose checkout a launch may still run in. A `conflict`
/// worktree holds a stopped merge the developer resolves in place, so it is
/// every bit as live as an `active` one.
const USABLE_WORKTREE_STATES: &[&str] = &["active", "conflict"];

/// Resolves launch directories. Cloning is cheap: both fields are already
/// reference-counted handles.
#[derive(Clone)]
pub struct LaunchPathsService {
    database: DatabaseConnection,
    profiles: ProfileStore,
}

impl LaunchPathsService {
    pub fn new(database: DatabaseConnection, profiles: ProfileStore) -> Self {
        Self { database, profiles }
    }

    pub async fn resolve(
        &self,
        request: LaunchPathsRequest,
    ) -> Result<LaunchPathsView, LaunchPathsError> {
        if request.version != SUPPORTED_VERSION {
            return Err(LaunchPathsError::unsupported_version());
        }
        match request.scope {
            LaunchScope::Task => self.task_paths(&request).await,
            LaunchScope::Plan | LaunchScope::Instant => self.scratch_paths(&request).await,
            LaunchScope::Docchat => self.document_paths(&request).await,
        }
    }

    pub(crate) fn preflight_module_folder(
        &self,
        module_id: &str,
    ) -> Result<PathBuf, super::ModuleFolderFailure> {
        let catalog = self.profiles.read();
        let folder = catalog
            .recent_profile_index
            .and_then(|index| usize::try_from(index).ok())
            .and_then(|index| catalog.profiles.get(index))
            .and_then(|profile| {
                profile
                    .module_links
                    .iter()
                    .rev()
                    .find(|link| compact_uuid(&link.module_id) == compact_uuid(module_id))
            })
            .map(|link| link.path.as_str());
        super::validate_module_folder(folder)
    }

    // -----------------------------------------------------------------
    // Task runs
    // -----------------------------------------------------------------

    async fn task_paths(
        &self,
        request: &LaunchPathsRequest,
    ) -> Result<LaunchPathsView, LaunchPathsError> {
        let task_id = request
            .task_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                LaunchPathsError::identity_required("A task launch needs a Work Item identity.")
            })?;
        let owner = owner::resolve(&self.database, task_id).await?;
        // The module is derived from the Work Item graph. A submitted module
        // is only ever checked against it, so a caller cannot point a launch
        // at another module's folder by naming one.
        let module_id = owner.module_id.clone().ok_or_else(|| {
            LaunchPathsError::new(
                LaunchPathsErrorCode::WorkItemInvalid,
                "That Work Item has no module to resolve a local folder from.",
            )
        })?;
        if let Some(submitted) = request.module_id.as_deref() {
            if compact_uuid(submitted) != compact_uuid(&module_id) {
                return Err(LaunchPathsError::module_mismatch());
            }
        }

        let (worktree_root, usage) = self.worktree_root(&owner).await?;
        let root = match worktree_root.clone() {
            Some(root) => Some(root),
            None => module_folder(&self.profiles, &module_id).filter(|folder| folder.is_dir()),
        };

        let module = self.module_identity(&module_id).await?;
        let task = self.task_identity(task_id).await?;
        let relative = match (root.as_ref(), module.as_ref(), task.as_ref()) {
            (Some(root), Some(module), Some(task)) => Some(
                design_directory::resolve_task_design_dir(root, module, task),
            ),
            _ => None,
        };

        Ok(LaunchPathsView {
            // Rust is the launch authority, so it must return the approved
            // module fallback as well as an isolated worktree override.
            working_directory: root.as_ref().map(|path| display(path.clone())),
            design_directory: materialize(root.as_deref(), relative.as_deref()),
            design_directory_relative: relative,
            module_directory_name: module.as_ref().map(design_directory::module_dir_name),
            document_relative_path: None,
            worktree: usage,
        })
    }

    /// The checkout a task launch may use, plus why it may or may not.
    ///
    /// A row in an unexpected state and a row whose directory has been removed
    /// are treated identically: the launch falls back rather than starting an
    /// agent in a directory that is no longer a checkout.
    async fn worktree_root(
        &self,
        owner: &WorktreeOwner,
    ) -> Result<(Option<PathBuf>, WorktreeUse), LaunchPathsError> {
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
            .one(&self.database)
            .await?;
        let top_level = owner.top_level_task_id.clone();
        let Some(row) = row else {
            return Ok((
                None,
                WorktreeUse::absent(top_level, owner.is_shared, WORKTREE_NONE),
            ));
        };
        if !USABLE_WORKTREE_STATES.contains(&row.status.as_str()) || !Path::new(&row.path).is_dir()
        {
            return Ok((
                None,
                WorktreeUse::absent(top_level, owner.is_shared, WORKTREE_CHECKOUT_MISSING),
            ));
        }
        Ok((
            Some(PathBuf::from(&row.path)),
            WorktreeUse::used(top_level, owner.is_shared, row.status),
        ))
    }

    // -----------------------------------------------------------------
    // Planning and instant runs
    // -----------------------------------------------------------------

    /// A scratch run is scoped to its module and its own Agent Run identity,
    /// so two independent planning runs never share a directory — and neither
    /// one ever consults, or creates, a task worktree.
    async fn scratch_paths(
        &self,
        request: &LaunchPathsRequest,
    ) -> Result<LaunchPathsView, LaunchPathsError> {
        let module_id = request
            .module_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                LaunchPathsError::identity_required("A scratch launch needs a module identity.")
            })?;
        let module = self.module_identity(module_id).await?;
        let root = module_folder(&self.profiles, module_id).filter(|folder| folder.is_dir());
        let relative = module
            .as_ref()
            .map(|module| design_directory::planning_design_dir(module, &request.agent_run_id));

        Ok(LaunchPathsView {
            working_directory: root.as_ref().map(|path| display(path.clone())),
            design_directory: materialize(root.as_deref(), relative.as_deref()),
            design_directory_relative: relative,
            module_directory_name: module.as_ref().map(design_directory::module_dir_name),
            document_relative_path: None,
            worktree: WorktreeUse::not_applicable(),
        })
    }

    // -----------------------------------------------------------------
    // Doc-chat runs
    // -----------------------------------------------------------------

    /// A doc-chat run is rooted at the authorized root of the exact registered
    /// document the user opened. The identity is a registry primary key, so it
    /// pins one registered copy — a task can hold the same relative path under
    /// both a worktree root and the module folder.
    async fn document_paths(
        &self,
        request: &LaunchPathsRequest,
    ) -> Result<LaunchPathsView, LaunchPathsError> {
        let document_id = request
            .document_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                LaunchPathsError::identity_required("A doc-chat launch needs a document identity.")
            })?;
        let row = design_document::Entity::find_by_id(compact_uuid(document_id))
            .one(&self.database)
            .await?;
        // An unregistered document, or one whose root has since moved, is not
        // an error: the launch degrades to the module folder and the prompt
        // still names the document the user opened.
        let Some(row) = row.filter(|row| Path::new(&row.root_dir).is_dir()) else {
            return Ok(LaunchPathsView {
                worktree: WorktreeUse::not_applicable(),
                ..LaunchPathsView::default()
            });
        };
        Ok(LaunchPathsView {
            working_directory: Some(row.root_dir.clone()),
            design_directory: Some(row.root_dir),
            design_directory_relative: None,
            module_directory_name: None,
            document_relative_path: Some(row.rel_path),
            worktree: WorktreeUse::not_applicable(),
        })
    }

    // -----------------------------------------------------------------
    // Work Management identities
    // -----------------------------------------------------------------

    /// A module or Work Item that cannot be read only costs the design
    /// directory, never the launch, so both resolve to `None` rather than
    /// failing the request.
    async fn module_identity(
        &self,
        module_id: &str,
    ) -> Result<Option<ModuleIdentity>, LaunchPathsError> {
        Ok(issue::Entity::find_by_id(compact_uuid(module_id))
            .one(&self.database)
            .await?
            .map(|row| ModuleIdentity {
                id: canonical_uuid(&row.id),
                name: row.name,
            }))
    }

    async fn task_identity(&self, task_id: &str) -> Result<Option<TaskIdentity>, LaunchPathsError> {
        Ok(issue::Entity::find_by_id(compact_uuid(task_id))
            .one(&self.database)
            .await?
            .map(|row| TaskIdentity {
                id: canonical_uuid(&row.id),
                name: row.name,
                sequence_id: row.sequence_id,
            }))
    }
}

/// Create the derived design directory and report it absolutely.
///
/// This is the boundary's only filesystem effect, and it is not a request a
/// caller can make: the directory is computed from the canonical layout under
/// an authorized root, so the same call cannot be pointed anywhere else. A
/// creation failure costs document sourcing and nothing else.
fn materialize(root: Option<&Path>, relative: Option<&str>) -> Option<String> {
    let (root, relative) = (root?, relative?);
    debug_assert!(
        relative.starts_with(SPEC_ROOT),
        "a design directory is always under the canonical spec root"
    );
    let resolved = root.join(relative);
    std::fs::create_dir_all(&resolved).ok()?;
    Some(display(resolved))
}

fn display(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::design_directory::PLANNING_SUBDIR;

    #[test]
    fn a_scratch_directory_is_created_under_the_canonical_layout() {
        let directory = tempfile::tempdir().expect("create a fixture root");
        let relative = format!("{SPEC_ROOT}/ticketry--cf2de16d/{PLANNING_SUBDIR}/0f7f2b8a");

        let created = materialize(Some(directory.path()), Some(&relative))
            .expect("materialize the design directory");

        assert!(Path::new(&created).is_dir());
        assert_eq!(created, display(directory.path().join(&relative)));
    }

    #[test]
    fn no_root_or_no_relative_directory_materializes_nothing() {
        let directory = tempfile::tempdir().expect("create a fixture root");

        assert_eq!(materialize(None, Some("spec/a/b")), None);
        assert_eq!(materialize(Some(directory.path()), None), None);
    }
}
