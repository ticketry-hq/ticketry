#![allow(non_snake_case)]

//! The authored `worktree_create` view.
//!
//! It is the restricted, model-shaped create seam for the Worktree model: one
//! non-null Work Item identity, one non-null operation identity, and nothing
//! else. Every protected field, including the repository root, checkout path,
//! branch, base, lifecycle status, identities, and timestamps, is derived by
//! the existing create service. The generated Worktree mutation bundle stays
//! private.
//!
//! The response is the authoritative live status of the checkout that now
//! exists, so the requesting window does not need to refetch.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::worktree::{
    create::{WorktreeCreateError, WorktreeCreateService},
    status::WorktreeStatusView,
};

struct CreateWorktreeView;

#[CustomFields]
impl CreateWorktreeView {
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

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CreateWorktreeView>();
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeCreateService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
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
