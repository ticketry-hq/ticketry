#![allow(non_snake_case)]

//! The authored `worktree_discard` view.
//!
//! It is the restricted, model-shaped delete seam for the Worktree model: one
//! non-null Work Item identity, one non-null operation identity, and nothing
//! else. There is no path, branch, repository, or force-cleanup argument, so
//! the caller cannot widen what a discard removes. The existing discard
//! service resolves the checkout and branch from Ticketry's indexed row.
//!
//! The response says whether a checkout was removed and carries the
//! authoritative status afterwards, so the requesting window does not need to
//! refetch.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::worktree::discard::{
    WorktreeDiscardError, WorktreeDiscardResult, WorktreeDiscardService,
};

struct DiscardWorktreeView;

#[CustomFields]
impl DiscardWorktreeView {
    /// Discard the one worktree this Work Item's top-level owner has.
    ///
    /// `operation_id` is the caller's stable identity for this intent. Reusing
    /// it replays the durable result instead of discarding a second time.
    async fn worktree_discard(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<WorktreeDiscardResult> {
        service(ctx)?
            .discard(&task_id, &operation_id)
            .await
            .map_err(worktree_discard_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_output::<WorktreeDiscardResult>();
    builder.register_custom_mutation::<DiscardWorktreeView>();
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeDiscardService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<WorktreeDiscardService>().map_err(|_| {
        Error::new("Discarding a worktree is unavailable.")
            .extend_with(|_, extension| extension.set("code", "worktree_discard_unavailable"))
    })
}

fn worktree_discard_error(error: WorktreeDiscardError) -> Error {
    let code = error.code_str();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", message))
}
