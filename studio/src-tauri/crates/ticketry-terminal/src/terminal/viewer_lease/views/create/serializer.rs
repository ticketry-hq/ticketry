use sea_orm::DatabaseTransaction;
use seaography::async_graphql::{dynamic::ResolverContext, Result};
use seaolim::{PreparedModelWrite, RestrictedModelMutation};

use crate::viewer_ownership::CreateViewerLease;
use ticketry_entities::terminals::viewer_lease;

use super::super::support;

pub(super) struct CreateViewerLeaseView;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<viewer_lease::Entity, viewer_lease::ActiveModel>
    for CreateViewerLeaseView
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<viewer_lease::ActiveModel, viewer_lease::Model>> {
        let input = CreateViewerLease {
            agent_run_id: ctx.args.try_get("agent_run_id")?.string()?.to_owned(),
            viewer_id: ctx.args.try_get("viewer_id")?.string()?.to_owned(),
            transport: ctx.args.try_get("transport")?.string()?.to_owned(),
        };
        let prepared = support::service(ctx)?
            .prepare_create_write(input, transaction)
            .await
            .map_err(support::graphql_error)?;
        Ok(support::prepared_write(prepared))
    }
}
