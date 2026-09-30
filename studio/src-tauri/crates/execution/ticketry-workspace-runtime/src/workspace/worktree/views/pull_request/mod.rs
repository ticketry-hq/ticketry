#![allow(non_snake_case)]

//! Ready-for-review GitHub pull-request creation for approved Changes views.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::worktree::changes::PullRequestCreationResult;

use super::commit::{command_error, service};

struct CreatePullRequestView;

#[CustomFields]
impl CreatePullRequestView {
    async fn worktree_pull_request_create(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<PullRequestCreationResult> {
        service(ctx)?
            .create_task_pull_request(&task_id, &operation_id)
            .await
            .map_err(command_error)
    }

    async fn module_checkout_pull_request_create(
        ctx: &Context<'_>,
        module_id: String,
        operation_id: String,
    ) -> Result<PullRequestCreationResult> {
        service(ctx)?
            .create_module_pull_request(&module_id, &operation_id)
            .await
            .map_err(command_error)
    }

    async fn worktree_pull_request_replace(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<PullRequestCreationResult> {
        service(ctx)?
            .replace_task_pull_request(&task_id, &operation_id)
            .await
            .map_err(command_error)
    }

    async fn worktree_pull_request_follow_up(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<PullRequestCreationResult> {
        service(ctx)?
            .follow_up_task_pull_request(&task_id, &operation_id)
            .await
            .map_err(command_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CreatePullRequestView>();
}
