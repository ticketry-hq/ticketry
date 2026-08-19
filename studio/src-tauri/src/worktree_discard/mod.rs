//! Throwing one task checkout away, and nothing else.
//!
//! Discard is the destructive end of the Workspace Runtime, so the whole
//! module is organised around keeping its blast radius exactly one checkout
//! wide. Studio confirms with the user, then submits two identities; every
//! path, ref, and row this operation may touch is read back out of Ticketry's
//! own index rather than accepted from the caller:
//!
//! 1. The subject is the *indexed row* ([`plan`]) — its repository, its
//!    checkout path, its branch — never a name re-derived from a Work Item
//!    that may since have been renamed.
//! 2. The operation is *prepared* before Git changes anything, carrying only
//!    relative identities ([`identity`]) — never a path, a command, or a force
//!    flag a recovery pass could read back as permission.
//! 3. Under the repository's lock ([`git_effects`]), Git is asked what it
//!    still holds and only the owed steps run: remove the checkout, prune its
//!    stale record, delete its branch. A path or ref that now belongs to
//!    another identity stops the operation instead of being cleaned up.
//! 4. The row is deleted and its durable `worktree.deleted` fact appended
//!    inside the operation's settlement transaction ([`settlement`]), through
//!    the shared [`crate::worktree_facts`] publisher, only once Git has
//!    released both the checkout and the ref.
//!
//! [`executor`] is the single performer of steps 3 and 4, shared by the
//! confirmed path and by startup reconciliation, and [`probe`] is what recovery
//! is allowed to conclude before that performer is ever invoked. Because every
//! step is guarded by a fresh observation, a crash at any boundary — after the
//! removal, after the prune, after the branch deletion, after the row deletion,
//! or after the response was lost — converges on the same durable answer.

mod error;
mod executor;
mod git_effects;
mod graphql;
mod identity;
mod plan;
mod probe;
mod service;
mod settlement;
mod view;

pub use error::{WorktreeDiscardError, WorktreeDiscardErrorCode};
pub use service::WorktreeDiscardService;
pub use view::WorktreeDiscardResult;

/// Register the authored discard mutation in the product schema.
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}
