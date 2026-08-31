//! Which Work Item actually owns the checkout.
//!
//! One top-level Work Item owns one worktree and every descendant shares it,
//! so a child's status is its parent's status with the shared flag set. The
//! owner is derived from the Work Item graph rather than from anything the
//! caller submits: Studio supplies an identity, not a parent, module, or
//! ticket number to trust.
//!
//! A module is a container, never an owner. Ancestry therefore stops at the
//! first module and the Work Item below it is the owner.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use ticketry_entities::work_management::issue;

use super::error::WorktreeStatusError;
use super::identity::{canonical_uuid, compact_uuid};

/// The Work Item graph is one level deep by design; the bound only stops a
/// corrupted parent cycle from walking forever.
const MAX_ANCESTRY_HOPS: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorktreeOwner {
    /// The Work Item the caller asked about, in public form.
    pub requested_task_id: String,
    /// The top-level Work Item that owns the checkout, in public form.
    pub top_level_task_id: String,
    /// The owning module, in public form, when the graph records one.
    pub module_id: Option<String>,
    /// True when the caller asked about a Work Item that shares an ancestor's
    /// worktree rather than owning one.
    pub is_shared: bool,
}

impl WorktreeOwner {
    pub fn top_level_row_id(&self) -> String {
        compact_uuid(&self.top_level_task_id)
    }
}

pub async fn resolve(
    database: &DatabaseConnection,
    requested_task_id: &str,
) -> Result<WorktreeOwner, WorktreeStatusError> {
    let requested = active_issue(database, requested_task_id)
        .await?
        .ok_or_else(WorktreeStatusError::work_item_not_found)?;
    if requested.r#type == "module" {
        return Err(WorktreeStatusError::work_item_invalid(
            "A module cannot own a worktree.",
        ));
    }

    let mut owner = requested.clone();
    let mut module_id = requested.module_id.clone();
    for _ in 0..MAX_ANCESTRY_HOPS {
        let Some(parent_id) = owner.parent_id.clone() else {
            break;
        };
        let Some(parent) = active_issue(database, &parent_id).await? else {
            break;
        };
        if parent.r#type == "module" {
            module_id.get_or_insert(parent.id.clone());
            break;
        }
        module_id = module_id.or_else(|| parent.module_id.clone());
        owner = parent;
    }

    Ok(WorktreeOwner {
        requested_task_id: canonical_uuid(&requested.id),
        top_level_task_id: canonical_uuid(&owner.id),
        module_id: module_id.as_deref().map(canonical_uuid),
        is_shared: owner.id != requested.id,
    })
}

async fn active_issue(
    database: &DatabaseConnection,
    identity: &str,
) -> Result<Option<issue::Model>, WorktreeStatusError> {
    Ok(issue::Entity::find_by_id(compact_uuid(identity))
        .filter(issue::Column::IsArchived.eq(false))
        .one(database)
        .await?)
}
