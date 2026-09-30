#![allow(non_snake_case)]

//! Confirmed local cleanup after a mapped pull request merges.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::worktree::discard::WorktreeDiscardResult;

use super::discard::{service, worktree_discard_error};

struct CleanupWorktreeView;

#[CustomFields]
impl CleanupWorktreeView {
    async fn worktree_cleanup(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
        confirmed: bool,
    ) -> Result<WorktreeDiscardResult> {
        service(ctx)?
            .cleanup(&task_id, &operation_id, confirmed)
            .await
            .map_err(worktree_discard_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CleanupWorktreeView>();
}
