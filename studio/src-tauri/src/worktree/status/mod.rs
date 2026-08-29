//! Authoritative live status for a Work Item's Git worktree.
//!
//! The `worktrees` table is an index: it records which top-level Work Item
//! owns which checkout, on which branch, cut from which base. Everything a
//! user actually looks at — is it clean, how far has it diverged, is a merge
//! stopped inside it, is the checkout even still there — belongs to Git, and
//! is read from Git on every request.
//!
//! Three rules hold every answer together:
//!
//! * **Ownership is derived.** One top-level Work Item owns the checkout and
//!   its descendants share it. A module is a container and never an owner.
//!   Studio supplies an identity; parents, modules, and repositories are
//!   resolved here from the Work Item graph and each Module's typed link.
//! * **Absence is data.** `none` (a repository exists but no worktree does)
//!   and `no_repo` (nothing could enclose this Work Item) are ordinary
//!   results. Only an unreadable database, an unrunnable Git, or an unknown
//!   Work Item is an error.
//! * **Nothing falls back.** If the module, its link, the folder, or the
//!   repository cannot be resolved, no Git command runs, so a status read can
//!   never end up describing an arbitrary working directory.
//!
//! Status-sensitive Git work is serialized by [`RepositoryLocks`], one lock
//! per canonical repository, so a busy repository never blocks another.

mod error;
mod git;
mod graphql;
pub(crate) mod identity;
mod live_facts;
// Ownership, repository resolution, and the checkout registry are the trusted
// derivations every worktree capability shares, so `crate::worktree::create`
// and `crate::worktree::discard` resolve through these rather than repeating
// the Work Item graph, the link rules, or Git's own bookkeeping.
pub(crate) mod owner;
pub(crate) mod registry;
pub(crate) mod repository;
mod repository_locks;
mod service;
mod view;

pub use error::{WorktreeStatusError, WorktreeStatusErrorCode};
pub use git::GitPort;
pub use repository_locks::RepositoryLocks;
pub use service::WorktreeStatusService;
pub use view::{WorktreeStatusView, KIND_NONE, KIND_NO_REPO, KIND_WORKTREE};

/// Register the authored live-status query in the product schema.
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}
