use sea_orm::DatabaseTransaction;
use seaography::async_graphql::{dynamic::ResolverContext, Result};
use seaolim::{PreparedModelWrite, RestrictedModelMutation};

use crate::viewer_ownership::DeleteViewerLease;
use ticketry_entities::viewer_lease;

use super::super::support;

pub(super) struct DeleteViewerLeaseView;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<viewer_lease::Entity, viewer_lease::ActiveModel>
    for DeleteViewerLeaseView
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<viewer_lease::ActiveModel, viewer_lease::Model>> {
        let input = DeleteViewerLease {
            agent_run_id: ctx.args.try_get("agent_run_id")?.string()?.to_owned(),
            viewer_id: ctx.args.try_get("viewer_id")?.string()?.to_owned(),
            generation: ctx.args.try_get("generation")?.string()?.to_owned(),
        };
        let prepared = support::service(ctx)?
            .prepare_delete_write(input, transaction)
            .await
            .map_err(support::graphql_error)?;
        Ok(support::prepared_write(prepared))
    }
}
