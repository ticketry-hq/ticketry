#![allow(non_snake_case)]

//! Authored Graph Run create view.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use super::{
    payload::GraphRunMutationPayload,
    support::{graphql_error, request, service},
};

struct CreateGraphRunView;

#[CustomFields]
impl CreateGraphRunView {
    async fn graph_run_create(
        ctx: &Context<'_>,
        root_id: String,
        execution_mode: Option<String>,
    ) -> Result<GraphRunMutationPayload> {
        let request = request(ctx, &root_id, execution_mode).await?;
        service(ctx)?
            .create(request)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<CreateGraphRunView>();
}
