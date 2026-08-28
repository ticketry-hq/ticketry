#![allow(non_snake_case)]

//! The authored `worktree_discard` mutation.
//!
//! It is the restricted, model-shaped delete seam for the Worktree model: one
//! non-null Work Item identity, one non-null operation identity, and nothing
//! else. There is no path, branch, repository, or force-cleanup argument to
//! give, so no caller can widen what a discard removes — the subject is the
//! row Ticketry itself indexed. That is why the generated Worktree mutation
//! bundle, whose `delete` accepts an arbitrary filter, stays private. See the
//! Slice 4 override record for the full reason and the tests that keep this
//! exception narrow.
//!
//! The response says whether a checkout was removed and carries the
//! authoritative status afterwards, so the window that confirmed does not have
//! to refetch to be correct.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::view::WorktreeDiscardResult;
use super::{WorktreeDiscardError, WorktreeDiscardService};

pub struct WorktreeDiscardMutations;

#[CustomFields]
impl WorktreeDiscardMutations {
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

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    // The result type is published here; the status it nests is the very same
    // `WorktreeStatusView` the live status query already registered.
    builder.register_custom_output::<WorktreeDiscardResult>();
    builder.register_custom_mutation::<WorktreeDiscardMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeDiscardService> {
    // Discard removes a checkout and a branch, so it may run only once this
    // process holds the workspace write lease.
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
