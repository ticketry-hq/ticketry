#![allow(non_snake_case)]

//! Explicit Git commit commands for task worktrees and module checkouts.
//!
//! Commit is a named operation because a Git effect cannot be represented as
//! Worktree model CRUD. Each command binds one stored identity, allows only a
//! message and operation identity, and derives every local path in Rust.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::worktree::changes::{
    RepositoryCommandResult, WorktreeChangesError, WorktreeChangesService,
};

struct CommitWorktreeView;

#[CustomFields]
impl CommitWorktreeView {
    async fn worktree_commit(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
        message: String,
    ) -> Result<RepositoryCommandResult> {
        service(ctx)?
            .commit_task(&task_id, &operation_id, &message)
            .await
            .map_err(command_error)
    }

    async fn module_checkout_commit(
        ctx: &Context<'_>,
        module_id: String,
        operation_id: String,
        message: String,
    ) -> Result<RepositoryCommandResult> {
        service(ctx)?
            .commit_module(&module_id, &operation_id, &message)
            .await
            .map_err(command_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CommitWorktreeView>();
}

pub(super) fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeChangesService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<WorktreeChangesService>().map_err(|_| {
        Error::new("Git commands are unavailable.")
            .extend_with(|_, extension| extension.set("code", "worktree_command_unavailable"))
    })
}

pub(super) fn command_error(error: WorktreeChangesError) -> Error {
    let code = error.code_str();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", message))
}
