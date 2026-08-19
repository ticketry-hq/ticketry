//! Everything an integration needs, derived from one Work Item identity.
//!
//! An integration is described entirely by facts that already exist: the
//! top-level Work Item that completed, the index row recording which checkout
//! it owns and which base that checkout was cut from, and the repository the
//! module is currently configured against. Nothing here is submitted, and
//! nothing is invented — the recorded base in particular is read off the row,
//! because landing somewhere other than where the branch was cut from is not
//! an integration.
//!
//! The same derivation runs twice in an operation's life: once when a
//! completion is delivered, and once when a restart re-resolves the subject
//! from the journal. Both therefore land here, and the second one *compares*
//! its result with the immutable intent rather than acting on it.

use std::path::PathBuf;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::worktrees::worktree;
use crate::settings_persistence::ProfileStore;
use crate::worktree_status::owner::{self, WorktreeOwner};
use crate::worktree_status::repository::{self, RepositoryResolution};
use crate::worktree_status::GitPort;

use super::error::WorktreeIntegrateError;

/// The derived identity of one landing.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct IntegrationPlan {
    pub(crate) owner: WorktreeOwner,
    /// The owning Work Item in row form — what the index and the journal key on.
    pub(crate) top_level_row_id: String,
    /// The canonical toplevel of the repository currently hosting the checkout.
    pub(crate) repository: PathBuf,
    /// A stable, path-free identity for that repository.
    pub(crate) repository_digest: String,
    pub(crate) worktree_id: String,
    pub(crate) checkout: PathBuf,
    pub(crate) checkout_name: String,
    pub(crate) branch: String,
    /// The base this checkout was cut from and must land back into.
    pub(crate) base_ref: String,
    pub(crate) ephemeral: bool,
    /// The recorded lifecycle state, `active` or `conflict`.
    pub(crate) state: String,
}

/// What the derivation could establish.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlanResolution {
    Plan(Box<IntegrationPlan>),
    /// This Work Item owns no checkout. Completing it is an ordinary no-op —
    /// which is exactly what completing a child, or a story that never opted
    /// in, must be.
    NoWorktree,
    /// The module the checkout belongs to no longer resolves to a repository.
    NoRepository(&'static str),
    /// The repository, branch, or checkout recorded on the row is not the one
    /// the module now resolves to. Nothing is landed on a guess.
    Mismatched { code: &'static str, detail: String },
}

pub(crate) async fn derive(
    work_items: &DatabaseConnection,
    profiles: &ProfileStore,
    git: &GitPort,
    task_id: &str,
) -> Result<PlanResolution, WorktreeIntegrateError> {
    let owner = owner::resolve(work_items, task_id).await?;
    let top_level_row_id = owner.top_level_row_id();
    let Some(row) = row_for(work_items, &top_level_row_id).await? else {
        return Ok(PlanResolution::NoWorktree);
    };
    let repository = match repository::resolve(profiles, git, owner.module_id.as_deref()).await? {
        RepositoryResolution::Repository(repository) => repository,
        RepositoryResolution::NoRepository(reason) => {
            return Ok(PlanResolution::NoRepository(reason))
        }
    };
    // The row records where the checkout was cut; the profile records where the
    // module points now. Landing is only defined when they are the same
    // repository, so a repointed module is reported rather than merged into.
    if !same_path(&row.repo_root, &repository) {
        return Ok(PlanResolution::Mismatched {
            code: "worktree_repository_mismatch",
            detail: "This Work Item's module now resolves to a different repository than the one its checkout was cut in.".to_owned(),
        });
    }
    let checkout = PathBuf::from(&row.path);
    let Some(checkout_name) = checkout
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
    else {
        return Ok(PlanResolution::Mismatched {
            code: "worktree_row_mismatch",
            detail: "The indexed checkout has no identifiable name.".to_owned(),
        });
    };
    Ok(PlanResolution::Plan(Box::new(IntegrationPlan {
        repository_digest: crate::worktree_create::identity::repository_digest(&repository),
        repository,
        top_level_row_id,
        worktree_id: row.id,
        checkout,
        checkout_name,
        branch: row.branch,
        base_ref: row.base_branch,
        ephemeral: row.ephemeral,
        state: row.status,
        owner,
    })))
}

/// The index row for one top-level Work Item. One Work Item owns at most one
/// checkout, so this is the whole membership question.
pub(crate) async fn row_for(
    work_items: &DatabaseConnection,
    top_level_row_id: &str,
) -> Result<Option<worktree::Model>, WorktreeIntegrateError> {
    Ok(worktree::Entity::find()
        .filter(worktree::Column::TaskId.eq(top_level_row_id))
        .one(work_items)
        .await?)
}

/// Compare a recorded root with a resolved one as the filesystem sees them, so
/// a symlinked or differently-spelled folder is still the same repository.
fn same_path(recorded: &str, resolved: &std::path::Path) -> bool {
    let recorded = std::path::Path::new(recorded);
    recorded == resolved
        || matches!(
            (recorded.canonicalize(), resolved.canonicalize()),
            (Ok(one), Ok(two)) if one == two
        )
}
