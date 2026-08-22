//! Opting one Work Item into an isolated Git checkout.
//!
//! Creation is the first place in the Workspace Runtime where SQLite and Git
//! must agree across a gap they cannot commit across together. A process can
//! stop after `git worktree add` and before the index row exists; two windows
//! can ask at the same moment; a transport can retry a request whose response
//! was lost. All three converge on the same branch, the same checkout, the
//! same row, and the same durable answer, because creation is expressed as one
//! Workspace Operation:
//!
//! 1. Everything is *derived* ([`plan`]): the top-level owner from the Work
//!    Item graph, the repository from the selected profile's module folder,
//!    and the branch and checkout path from the established naming contract
//!    ([`naming`]). Studio submits two identities and no authority.
//! 2. The operation is *prepared* before Git changes anything, carrying only
//!    relative identities ([`identity`]) — never a path, a command, or a
//!    caller-selected absolute location.
//! 3. The effect runs under the repository's lock, through the shared
//!    argument-vector Git port ([`git_effects`]), with no database transaction
//!    open across it.
//! 4. The index row and its durable `worktree.changed` fact commit inside the
//!    operation's settlement transaction ([`settlement`]), only once Git has
//!    proved the exact checkout on the exact branch.
//!
//! [`executor`] is the single performer of steps 3 and 4, shared by the
//! interactive path and by startup reconciliation, and [`probe`] is what
//! recovery is allowed to conclude before that performer is ever invoked.

mod error;
mod executor;
mod git_effects;
mod graphql;
// The resource key and the path-free repository digest are the worktree
// journal's shared identity vocabulary, so `crate::worktree_discard` names the
// same subject rather than inventing a second spelling of it.
pub(crate) mod identity;
mod naming;
mod plan;
mod probe;
mod service;
mod settlement;

#[cfg(test)]
pub(crate) mod test_support;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::worktrees::worktree;

pub use error::{WorktreeCreateError, WorktreeCreateErrorCode};
pub use service::WorktreeCreateService;

/// Register the authored create mutation in the product schema.
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}

/// The index row for a plan's owning Work Item, if one exists. One Work Item
/// owns at most one checkout, so this is the whole membership question.
pub(crate) async fn row_for(
    work_items: &DatabaseConnection,
    plan: &plan::CreatePlan,
) -> Result<Option<worktree::Model>, WorktreeCreateError> {
    Ok(worktree::Entity::find()
        .filter(worktree::Column::TaskId.eq(plan.owner.top_level_row_id()))
        .one(work_items)
        .await?)
}
