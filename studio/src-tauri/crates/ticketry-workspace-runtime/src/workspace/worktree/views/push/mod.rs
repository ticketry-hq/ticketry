#![allow(non_snake_case)]

//! Explicit Git push commands for task worktrees and module checkouts.
//!
//! Push is a named operation because a remote Git effect cannot be represented
//! as Worktree model CRUD. The service derives the checkout and push target,
//! never stages files, and runs under the repository lock.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::worktree::changes::RepositoryCommandResult;

use super::commit::{command_error, service};

struct PushWorktreeView;

#[CustomFields]
impl PushWorktreeView {
    async fn worktree_push(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<RepositoryCommandResult> {
        service(ctx)?
            .push_task(&task_id, &operation_id)
            .await
            .map_err(command_error)
    }

    async fn module_checkout_push(
        ctx: &Context<'_>,
        module_id: String,
        operation_id: String,
    ) -> Result<RepositoryCommandResult> {
        service(ctx)?
            .push_module(&module_id, &operation_id)
            .await
            .map_err(command_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<PushWorktreeView>();
}
