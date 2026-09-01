//! Reconciling the Design Document registry against the filesystem.
//!
//! The filesystem is authoritative for what a design directory contains, so a
//! listing is a reconciliation rather than a plain read: files written while no
//! watcher was alive are registered, rows whose bytes changed are refreshed,
//! rows whose primary file is gone are pruned, and the authoritative rows are
//! returned.
//!
//! The pass is deliberately convergent. An unchanged directory registers
//! nothing, refreshes nothing, and prunes nothing, so repeating it writes no
//! row and publishes no event. That is what lets the watcher treat a full
//! rescan as its universal fallback: after a missed event, an overflowing
//! queue, a watcher error, or a restart, replaying discovery from the
//! filesystem costs one comparison and converges on exactly the same registry.

use std::collections::BTreeSet;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};

use ticketry_entities::design_document;

use super::authorized_roots;
use super::error::DocumentsError;
use super::identity::{canonical_uuid, identity_spellings};
use super::registry_facts::DocumentFactRecorder;
use super::registry_plan::plan_roots;
use super::registry_settlement::{self, RegistrationIdentity};

/// The bucket every planning and instant document belongs to. It is a Work
/// Item identity shaped like a UUID so one column can address both buckets.
pub const SCRATCH_TASK_ID: &str = "00000000-0000-0000-0000-000000000000";

/// Scope recorded on a row a task rescan discovers.
const TASK_SCOPE: &str = "task";
/// Scope recorded on a row a scratch rescan discovers.
const SCRATCH_SCOPE: &str = "plan";

/// What a caller may say about the task whose registry is being refreshed.
/// Only the Work Item identity is required; the project and module let the
/// canonical design directory be re-resolved so unregistered files are found.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TaskRegistryScope {
    pub task_id: String,
    pub project_id: Option<String>,
    pub module_id: Option<String>,
}

/// Reconcile and return one Work Item's documents.
pub async fn refresh_task(
    database: &DatabaseConnection,
    facts: Option<&DocumentFactRecorder>,
    scope: &TaskRegistryScope,
) -> Result<Vec<design_document::Model>, DocumentsError> {
    let rows = list_for_task(database, &scope.task_id).await?;
    let mut roots: BTreeSet<String> = rows.iter().map(|row| row.root_dir.clone()).collect();
    roots.extend(authorized_roots::task_run_roots(database, &scope.task_id).await?);
    if let (Some(project_id), Some(module_id)) = (&scope.project_id, &scope.module_id) {
        if let Some(canonical) =
            authorized_roots::canonical_task_root(database, project_id, module_id, &scope.task_id)
                .await
        {
            roots.insert(canonical);
        }
    }
    // A row written before this rescan already carries the module the bucket
    // belongs to; the caller's module is only a hint for finding new files.
    let module_id = scope
        .module_id
        .clone()
        .or_else(|| rows.first().map(|row| row.module_id.clone()))
        .unwrap_or_default();
    let identity = RegistrationIdentity {
        module_id,
        task_id: canonical_uuid(&scope.task_id),
        scope: TASK_SCOPE.to_owned(),
        discovered_by_run_id: None,
    };
    registry_settlement::settle(database, facts, &identity, plan_roots(&roots, &rows)).await?;
    list_for_task(database, &scope.task_id).await
}

/// Reconcile and return one module's scratch (planning and instant) documents.
pub async fn refresh_scratch(
    database: &DatabaseConnection,
    facts: Option<&DocumentFactRecorder>,
    module_id: &str,
) -> Result<Vec<design_document::Model>, DocumentsError> {
    let rows = list_for_scratch(database, module_id).await?;
    let mut roots: BTreeSet<String> = rows.iter().map(|row| row.root_dir.clone()).collect();
    roots.extend(authorized_roots::scratch_run_roots(database, module_id).await?);
    let identity = RegistrationIdentity {
        module_id: canonical_uuid(module_id),
        task_id: SCRATCH_TASK_ID.to_owned(),
        scope: SCRATCH_SCOPE.to_owned(),
        discovered_by_run_id: None,
    };
    registry_settlement::settle(database, facts, &identity, plan_roots(&roots, &rows)).await?;
    list_for_scratch(database, module_id).await
}

/// Settle exactly the paths a watcher observed under one authorized root.
///
/// The rows compared are the ones registered under this root, so one run's
/// watcher can never register or prune another root's documents.
pub async fn settle_paths(
    database: &DatabaseConnection,
    facts: Option<&DocumentFactRecorder>,
    identity: &RegistrationIdentity,
    root: &str,
    rel_paths: &BTreeSet<String>,
) -> Result<(), DocumentsError> {
    if rel_paths.is_empty() {
        return Ok(());
    }
    let rows = list_for_root(database, root).await?;
    let plan = super::registry_plan::plan_paths(root, rel_paths, &rows);
    registry_settlement::settle(database, facts, identity, plan).await
}

/// Rescan one authorized root a watcher owns, in full.
///
/// This is the watcher's universal fallback: after an error, an overflowed
/// queue, or a restart, the event stream is not treated as complete, and the
/// filesystem is re-read instead.
pub async fn rescan_root(
    database: &DatabaseConnection,
    facts: Option<&DocumentFactRecorder>,
    identity: &RegistrationIdentity,
    root: &str,
) -> Result<(), DocumentsError> {
    let rows = list_for_root(database, root).await?;
    let roots = BTreeSet::from([root.to_owned()]);
    registry_settlement::settle(database, facts, identity, plan_roots(&roots, &rows)).await
}

/// One Work Item's registry rows, in the order Studio renders them.
pub async fn list_for_task(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Vec<design_document::Model>, DocumentsError> {
    Ok(design_document::Entity::find()
        .filter(design_document::Column::TaskId.is_in(identity_spellings(task_id)))
        .order_by_asc(design_document::Column::RelPath)
        .order_by_asc(design_document::Column::Id)
        .all(database)
        .await?)
}

/// One module's scratch registry rows, in the order Studio renders them.
pub async fn list_for_scratch(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<Vec<design_document::Model>, DocumentsError> {
    Ok(design_document::Entity::find()
        .filter(design_document::Column::TaskId.is_in(identity_spellings(SCRATCH_TASK_ID)))
        .filter(design_document::Column::ModuleId.is_in(identity_spellings(module_id)))
        .order_by_asc(design_document::Column::RelPath)
        .order_by_asc(design_document::Column::Id)
        .all(database)
        .await?)
}

/// Every row registered under one authorized root.
async fn list_for_root(
    database: &DatabaseConnection,
    root: &str,
) -> Result<Vec<design_document::Model>, DocumentsError> {
    Ok(design_document::Entity::find()
        .filter(design_document::Column::RootDir.eq(root))
        .order_by_asc(design_document::Column::RelPath)
        .all(database)
        .await?)
}
