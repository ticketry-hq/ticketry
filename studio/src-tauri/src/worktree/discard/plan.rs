//! Exactly what one discard is allowed to touch.
//!
//! Everything here comes from the authoritative index row: the repository that
//! hosts the checkout, the checkout path, and the task branch. A discard never
//! re-derives those from a Work Item's current name, because a renamed Work
//! Item would derive a *different* branch and a different directory — and this
//! operation exists to remove the one that was actually cut.
//!
//! The caller contributes no part of this plan. It submits a Work Item
//! identity, which selects the row; the row says the rest.

use std::path::PathBuf;

use crate::entities::worktrees::worktree;

/// The exact subject of one discard.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiscardPlan {
    /// The indexed Worktree row's own identity — what the delete is bound to.
    pub(crate) worktree_id: String,
    /// The top-level Work Item that owns the checkout, in row form.
    pub(crate) top_level_row_id: String,
    /// The canonical toplevel of the repository hosting the checkout.
    pub(crate) repository: PathBuf,
    /// A stable, path-free identity for that repository, for the journal.
    pub(crate) repository_digest: String,
    pub(crate) checkout: PathBuf,
    /// The checkout's own directory name — the relative identity the journal
    /// remembers instead of an absolute path.
    pub(crate) checkout_name: String,
    pub(crate) branch: String,
    /// The base the checkout would have integrated into. A discard never
    /// touches it; it is published so a consumer can name what was abandoned.
    pub(crate) base_ref: String,
    pub(crate) pull_request_url: Option<String>,
    pub(crate) ephemeral: bool,
}

impl DiscardPlan {
    pub(crate) fn for_row(row: &worktree::Model) -> Self {
        let repository = PathBuf::from(&row.repo_root);
        let repository = repository.canonicalize().unwrap_or(repository);
        let checkout = PathBuf::from(&row.path);
        Self {
            worktree_id: row.id.clone(),
            top_level_row_id: row.task_id.clone(),
            repository_digest: crate::worktree::create::identity::repository_digest(&repository),
            repository,
            checkout_name: checkout_name(&checkout),
            checkout,
            branch: row.branch.clone(),
            base_ref: row.base_branch.clone(),
            pull_request_url: row.pull_request_url.clone(),
            ephemeral: row.ephemeral,
        }
    }
}

/// The checkout directory's own name. An indexed path always has one; a
/// pathological row without one still yields a stable, comparable identity.
fn checkout_name(checkout: &std::path::Path) -> String {
    checkout
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "checkout".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_journal_remembers_a_relative_checkout_identity_rather_than_a_path() {
        assert_eq!(
            checkout_name(std::path::Path::new(
                "/checkouts/ticketry/CODIN-881-parent-story"
            )),
            "CODIN-881-parent-story"
        );
        // A pathological row still yields something stable to compare, rather
        // than an empty identity the journal would refuse.
        assert_eq!(checkout_name(std::path::Path::new("/")), "checkout");
    }
}
