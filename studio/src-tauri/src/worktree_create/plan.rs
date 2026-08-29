//! Everything a creation needs, derived from one Work Item identity.
//!
//! Studio submits a Work Item and an operation identity. The owning top-level
//! Work Item, its module, its project, its ticket sequence, the repository
//! that encloses the module's configured folder, the task branch, and the
//! checkout path are all resolved here from trusted data. Nothing a caller
//! sends becomes a path, a branch, or a repository.
//!
//! The same derivation runs twice in an operation's life: once when Studio
//! asks, and once when startup reconciliation re-resolves the subject from the
//! journal. Both paths therefore land in this module, which is why it takes
//! only identities and returns only derived facts.

use std::path::PathBuf;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::work_management::{issue, project, workspace};
use crate::worktree_status::owner::{self, WorktreeOwner};
use crate::worktree_status::repository::{self, RepositoryResolution};
use crate::worktree_status::GitPort;

use super::error::WorktreeCreateError;
use super::naming;

/// The derived identity of one task checkout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CreatePlan {
    pub(crate) owner: WorktreeOwner,
    /// The canonical toplevel of the repository that will host the checkout.
    pub(crate) repository: PathBuf,
    /// A stable, path-free identity for that repository. The journal never
    /// stores an absolute path, so this is what a later pass compares against.
    pub(crate) repository_digest: String,
    pub(crate) checkout_name: String,
    pub(crate) branch: String,
    pub(crate) checkout: PathBuf,
    pub(crate) ticket_seq: Option<i32>,
    pub(crate) project_id: Option<String>,
    pub(crate) workspace_slug: Option<String>,
}

/// Either the derivation succeeded, or nothing could enclose the Work Item —
/// which is ordinary data rather than a failure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlanResolution {
    Plan(Box<CreatePlan>),
    NoRepository(&'static str),
}

pub(crate) async fn derive(
    work_items: &DatabaseConnection,
    git: &GitPort,
    requested_task_id: &str,
) -> Result<PlanResolution, WorktreeCreateError> {
    let owner = owner::resolve(work_items, requested_task_id).await?;
    let repository = match repository::resolve(work_items, git, owner.module_id.as_deref()).await?
    {
        RepositoryResolution::Repository(repository) => repository,
        RepositoryResolution::NoRepository(reason) => {
            return Ok(PlanResolution::NoRepository(reason))
        }
    };
    Ok(PlanResolution::Plan(Box::new(
        for_owner(work_items, owner, repository).await?,
    )))
}

/// The derivation from an already-resolved owner and repository. Reconciliation
/// enters here, because it re-resolves the repository from the journalled
/// module rather than from the caller.
pub(crate) async fn for_owner(
    work_items: &DatabaseConnection,
    owner: WorktreeOwner,
    repository: PathBuf,
) -> Result<CreatePlan, WorktreeCreateError> {
    let top_level = issue::Entity::find_by_id(owner.top_level_row_id())
        .filter(issue::Column::IsArchived.eq(false))
        .one(work_items)
        .await?
        .ok_or_else(WorktreeCreateError::work_item_not_found)?;

    let checkout_name =
        naming::checkout_name(Some(top_level.sequence_id), &naming::slug(&top_level.name));
    let branch = naming::branch_name(&checkout_name);
    let checkout = naming::checkout_path(&repository, &checkout_name);
    Ok(CreatePlan {
        repository_digest: super::identity::repository_digest(&repository),
        repository,
        checkout_name,
        branch,
        checkout,
        ticket_seq: Some(top_level.sequence_id),
        project_id: Some(top_level.project_id.clone()),
        workspace_slug: workspace_slug(work_items, &top_level.project_id).await?,
        owner,
    })
}

/// The workspace the owning project belongs to, recorded on the row as
/// metadata. It is derived from the Work Item graph, never from a caller and
/// never from local configuration.
async fn workspace_slug(
    work_items: &DatabaseConnection,
    project_id: &str,
) -> Result<Option<String>, WorktreeCreateError> {
    let Some(project) = project::Entity::find_by_id(project_id.to_owned())
        .one(work_items)
        .await?
    else {
        return Ok(None);
    };
    Ok(workspace::Entity::find_by_id(project.workspace_id)
        .one(work_items)
        .await?
        .map(|row| row.slug)
        .filter(|slug| !slug.is_empty()))
}
