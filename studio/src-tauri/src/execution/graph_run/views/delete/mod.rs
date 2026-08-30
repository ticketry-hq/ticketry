#![allow(non_snake_case)]

//! Authored Graph Run delete view.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use super::{
    payload::GraphRunDeletePayload,
    support::{caller_access, graphql_error, service},
};

struct DeleteGraphRunView;

#[CustomFields]
impl DeleteGraphRunView {
    async fn graph_run_delete(ctx: &Context<'_>, root_id: String) -> Result<GraphRunDeletePayload> {
        let access = caller_access(ctx, &root_id).await?;
        service(ctx)?
            .delete(&root_id, &access)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<DeleteGraphRunView>();
}
