#![allow(non_snake_case)]

//! The authored `worktree_create` mutation.
//!
//! It is the restricted, model-shaped create seam for the Worktree model: one
//! non-null Work Item identity, one non-null operation identity, and nothing
//! else. Every protected field — repository root, checkout path, branch, base
//! ref, base commit, lifecycle status, ephemeral flag, identities, and
//! timestamps — is derived inside Rust, so the generated Worktree mutation
//! bundle stays private. See the Slice 4 override record for the full reason
//! and the tests that keep this exception narrow.
//!
//! The response is the authoritative live status of the checkout that now
//! exists, so the window that asked does not have to refetch to be correct.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use crate::worktree_status::WorktreeStatusView;

use super::{WorktreeCreateError, WorktreeCreateService};

pub struct WorktreeCreateMutations;

#[CustomFields]
impl WorktreeCreateMutations {
    /// Create the one worktree this Work Item's top-level owner has, or
    /// converge on the one it already has.
    ///
    /// `operation_id` is the caller's stable identity for this intent. Reusing
    /// it replays the durable result instead of creating a second checkout.
    async fn worktree_create(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<WorktreeStatusView> {
        service(ctx)?
            .create(&task_id, &operation_id)
            .await
            .map_err(worktree_create_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<WorktreeCreateMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeCreateService> {
    // Creation runs Git and inserts the index row, so it may run only once this
    // process holds the workspace write lease.
    if !crate::workspace_handoff::gate::open(ctx) {
        return Err(crate::workspace_handoff::gate::unavailable());
    }
    ctx.data::<WorktreeCreateService>().map_err(|_| {
        Error::new("Worktree creation is unavailable.")
            .extend_with(|_, extension| extension.set("code", "worktree_create_unavailable"))
    })
}

fn worktree_create_error(error: WorktreeCreateError) -> Error {
    let code = error.code_str();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", message))
}
