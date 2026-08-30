#![allow(non_snake_case)]

//! Authored Graph Run update view.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use super::{
    payload::GraphRunMutationPayload,
    support::{graphql_error, request, service},
};

struct UpdateGraphRunView;

#[CustomFields]
impl UpdateGraphRunView {
    async fn graph_run_update(
        ctx: &Context<'_>,
        root_id: String,
        execution_mode: Option<String>,
    ) -> Result<GraphRunMutationPayload> {
        let request = request(ctx, &root_id, execution_mode).await?;
        service(ctx)?
            .update(request)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<UpdateGraphRunView>();
}
