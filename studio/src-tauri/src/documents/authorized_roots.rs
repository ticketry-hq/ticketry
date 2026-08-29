//! Which absolute directories a rescan is allowed to look inside.
//!
//! A root is never accepted from a caller. It is derived from owned data:
//! the roots already registered for this bucket, the design directories of the
//! bucket's own Agent Runs, and — for a task — the canonical design directory
//! resolved from the module's linked folder. Anything else is simply not a
//! place Ticketry reads documents from.

use std::collections::BTreeSet;
use std::path::Path;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, QueryFilter};

use crate::entities::runs::agent_run;
use crate::entities::work_management::issue;

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

/// The canonical task design directory under the module's linked folder, when
/// the module is linked and the folder is present.
///
/// Every step can legitimately be missing — no module link, a moved folder, an
/// unknown module or Work Item — and each of those only costs the discovery of
/// files that are not registered yet, never the listing.
pub(super) async fn canonical_task_root(
    database: &DatabaseConnection,
    project_id: &str,
    module_id: &str,
    task_id: &str,
) -> Option<String> {
    let folder = crate::module_links::resolution::resolved_folder(database, module_id).await?;
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
