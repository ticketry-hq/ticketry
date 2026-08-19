//! Which absolute directories a rescan is allowed to look inside.
//!
//! A root is never accepted from a caller. It is derived from owned data:
//! the roots already registered for this bucket, the design directories of the
//! bucket's own Agent Runs, and — for a task — the canonical design directory
//! resolved from the selected profile's module folder. Anything else is simply
//! not a place Ticketry reads documents from.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, QueryFilter};

use crate::entities::runs::agent_run;
use crate::entities::work_management::issue;
use crate::settings_persistence::ProfileStore;

use super::design_directory::{self, ModuleIdentity, TaskIdentity};
use super::error::DocumentsError;
use super::identity::{canonical_uuid, compact_uuid};

/// Scopes whose Agent Runs write into a module's scratch workspace.
const SCRATCH_RUN_SCOPES: &[&str] = &["plan", "instant"];

/// The design directories of every Agent Run bound to one Work Item.
pub(super) async fn task_run_roots(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<BTreeSet<String>, DocumentsError> {
    let rows = agent_run::Entity::find()
        .filter(agent_run::Column::IssueId.eq(compact_uuid(task_id)))
        .filter(agent_run::Column::DesignDir.is_not_null())
        .all(database)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.design_dir)
        .map(|root| canonical_root(&root))
        .collect())
}

/// The design directories of every planning or instant run that targets one
/// module. A scratch run is bound to the module itself rather than to a Work
/// Item, so its runs are found through the module's own issue graph.
pub(super) async fn scratch_run_roots(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<BTreeSet<String>, DocumentsError> {
    let module_id = compact_uuid(module_id);
    let owned: Vec<String> = issue::Entity::find()
        .filter(
            issue::Column::Id
                .eq(module_id.clone())
                .or(issue::Column::ModuleId.eq(module_id)),
        )
        .all(database)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect();
    if owned.is_empty() {
        return Ok(BTreeSet::new());
    }
    let rows = agent_run::Entity::find()
        .filter(agent_run::Column::IssueId.is_in(owned))
        .filter(agent_run::Column::Scope.is_in(SCRATCH_RUN_SCOPES.iter().copied()))
        .filter(agent_run::Column::DesignDir.is_not_null())
        .all(database)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.design_dir)
        .map(|root| canonical_root(&root))
        .collect())
}

/// The canonical task design directory under the selected profile's module
/// folder, when one is configured and present.
///
/// Every step can legitimately be missing — no profile, no module link, a
/// moved folder, an unknown module or Work Item — and each of those only costs
/// the discovery of files that are not registered yet, never the listing.
pub(super) async fn canonical_task_root(
    database: &DatabaseConnection,
    profiles: &ProfileStore,
    project_id: &str,
    module_id: &str,
    task_id: &str,
) -> Option<String> {
    let folder = module_folder(profiles, module_id)?;
    if !folder.is_dir() {
        return None;
    }
    // Both rows are read through the generated entity, and both must belong to
    // the project the caller named. A module or Work Item from another project
    // resolves to nothing rather than to a directory in someone else's folder.
    let project_id = compact_uuid(project_id);
    let module = issue::Entity::find_by_id(compact_uuid(module_id))
        .one(database)
        .await
        .ok()
        .flatten()
        .filter(|row| row.project_id == project_id)
        .map(|row| ModuleIdentity {
            id: canonical_uuid(&row.id),
            name: row.name,
        })?;
    let task = issue::Entity::find_by_id(compact_uuid(task_id))
        .one(database)
        .await
        .ok()
        .flatten()
        .filter(|row| row.project_id == project_id)
        .map(|row| TaskIdentity {
            id: canonical_uuid(&row.id),
            name: row.name,
            sequence_id: row.sequence_id,
        })?;
    let relative = design_directory::resolve_task_design_dir(&folder, &module, &task);
    let resolved = folder.join(relative);
    Some(
        resolved
            .canonicalize()
            .unwrap_or(resolved)
            .to_string_lossy()
            .into_owned(),
    )
}

/// The selected profile's local folder for one module. Only the selected
/// profile is consulted, because that is the profile the rest of Ticketry
/// launches and reads against.
fn module_folder(profiles: &ProfileStore, module_id: &str) -> Option<PathBuf> {
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

/// Whether a registered root still resolves to a readable directory. A root
/// that does not is skipped rather than reported: its rows are pruned by the
/// ordinary missing-file pass.
pub(super) fn is_readable_root(root: &str) -> bool {
    Path::new(root).is_dir()
}

/// The one spelling of a root the registry keys rows by.
///
/// One directory can be named several ways — a symlinked ancestor, a trailing
/// slash, a relative segment — and an Agent Run records whichever spelling
/// launched it while the canonical design directory is resolved separately.
/// Without a single spelling the same file registers twice, under two roots,
/// and every change to it publishes two facts. A root that cannot be resolved
/// keeps the spelling it has: it is about to be skipped or pruned anyway.
pub(crate) fn canonical_root(root: &str) -> String {
    Path::new(root)
        .canonicalize()
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| root.to_owned())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::settings_persistence::{ModuleLink, Profile, ProfileCatalog, ProfileStore};

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

    #[test]
    fn a_module_folder_is_resolved_through_either_identity_spelling() {
        let directory = tempfile::tempdir().expect("create a settings directory");
        let profiles = store(
            directory.path(),
            vec![ModuleLink {
                module_id: "cf2de16defbd4106b0e4ceab58b90b22".to_owned(),
                path: "/repos/ticketry".to_owned(),
            }],
        );

        assert_eq!(
            module_folder(&profiles, "cf2de16d-efbd-4106-b0e4-ceab58b90b22"),
            Some(PathBuf::from("/repos/ticketry"))
        );
    }

    #[test]
    fn an_unconfigured_or_blank_module_link_resolves_to_no_folder() {
        let directory = tempfile::tempdir().expect("create a settings directory");
        let profiles = store(
            directory.path(),
            vec![ModuleLink {
                module_id: "cf2de16d-efbd-4106-b0e4-ceab58b90b22".to_owned(),
                path: "   ".to_owned(),
            }],
        );

        assert_eq!(
            module_folder(&profiles, "cf2de16d-efbd-4106-b0e4-ceab58b90b22"),
            None
        );
        assert_eq!(
            module_folder(&profiles, "11111111-1111-1111-1111-111111111111"),
            None
        );
    }
}
