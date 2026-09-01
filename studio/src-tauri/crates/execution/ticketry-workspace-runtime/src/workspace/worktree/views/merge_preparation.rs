#![allow(non_snake_case)]

//! User-confirmed merge preparation for one mapped task pull request.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::worktree::changes::{
    MergePreparationError, MergePreparationResult, MergePreparationService,
};

struct MergePreparationView;

#[CustomFields]
impl MergePreparationView {
    async fn worktree_pull_request_merge_prepare(
        ctx: &Context<'_>,
        task_id: String,
        operation_id: String,
    ) -> Result<MergePreparationResult> {
        service(ctx)?
            .launch(&task_id, &operation_id)
            .await
            .map_err(merge_preparation_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    crate::worktree::changes::assert_merge_preparation_operation_registered();
    builder.register_custom_output::<MergePreparationResult>();
    builder.register_custom_mutation::<MergePreparationView>();
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a MergePreparationService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<MergePreparationService>().map_err(|_| {
        Error::new("Merge preparation is unavailable.")
            .extend_with(|_, extension| extension.set("code", "merge_preparation_unavailable"))
    })
}

fn merge_preparation_error(error: MergePreparationError) -> Error {
    let code = error.code_str();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", message))
}
