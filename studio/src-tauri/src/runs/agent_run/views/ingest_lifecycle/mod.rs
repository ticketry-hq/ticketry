#![allow(non_snake_case)]

//! Authored lifecycle-ingress view. Ordering, idempotency, Agent Run updates,
//! and status publication remain in the existing lifecycle transaction.

mod payload;

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::runs_persistence::LifecycleFact;

use self::payload::LifecycleAccepted;
use super::super::support::{graphql_error, services};

struct IngestAgentLifecycleView;

#[CustomFields]
impl IngestAgentLifecycleView {
    async fn ingest_agent_lifecycle(
        ctx: &Context<'_>,
        agent_run_id: String,
        kind: String,
        occurred_at: String,
        provider_session_id: Option<String>,
    ) -> Result<LifecycleAccepted> {
        services(ctx)?
            .lifecycle()
            .apply_lifecycle_fact(LifecycleFact {
                agent_run_id,
                kind,
                occurred_at,
                provider_session_id,
            })
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_output::<LifecycleAccepted>();
    builder.register_custom_mutation::<IngestAgentLifecycleView>();
}
