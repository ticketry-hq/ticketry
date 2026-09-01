#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::persistence::AgentRunHolding;

use super::super::support::{graphql_error, services};

struct AgentRunHoldingsQuery;

#[CustomFields]
impl AgentRunHoldingsQuery {
    async fn agent_run_holdings(
        ctx: &Context<'_>,
        project_id: String,
        task_id: Option<String>,
    ) -> Result<Vec<AgentRunHolding>> {
        services(ctx)?
            .queries()
            .run_holdings(&project_id, task_id.as_deref())
            .await
            .map_err(graphql_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_query::<AgentRunHoldingsQuery>();
}
