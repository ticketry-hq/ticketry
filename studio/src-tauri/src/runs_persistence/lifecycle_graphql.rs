#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomOutputType,
};
use serde::Serialize;

use super::{
    AgentRunHolding, LifecycleAcceptance, LifecycleFact, RunsPersistenceError, RunsServices,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct LifecycleAccepted {
    pub accepted: bool,
    pub known_run: bool,
    pub applied: bool,
    pub state: Option<String>,
    pub occurred_at: String,
    pub event_cursor: Option<i64>,
}

impl From<LifecycleAcceptance> for LifecycleAccepted {
    fn from(value: LifecycleAcceptance) -> Self {
        Self {
            accepted: value.accepted,
            known_run: value.known_run,
            applied: value.applied,
            state: value.state,
            occurred_at: value.occurred_at,
            event_cursor: value.event_cursor,
        }
    }
}

pub struct AgentRunQueries;

#[CustomFields]
impl AgentRunQueries {
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

pub struct AgentRunMutations;

#[CustomFields]
impl AgentRunMutations {
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

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<AgentRunHolding>();
    builder.register_custom_output::<LifecycleAccepted>();
    builder.register_custom_query::<AgentRunQueries>();
    builder.register_custom_mutation::<AgentRunMutations>();
    builder
}

fn services<'a>(ctx: &'a Context<'a>) -> Result<&'a RunsServices> {
    ready(ctx)?;
    ctx.data::<RunsServices>().map_err(|_| unavailable())
}

/// Every Runs query and command passes through the readiness gate first. A
/// partially ready runtime refuses rather than reaching a half-adopted store.
fn ready(ctx: &Context<'_>) -> Result<()> {
    if super::readiness_gate::open(ctx) {
        Ok(())
    } else {
        Err(super::readiness_gate::unavailable())
    }
}

fn unavailable() -> Error {
    Error::new("The Runs service is unavailable.")
        .extend_with(|_, extension| extension.set("code", "runs_unavailable"))
}

fn graphql_error(error: RunsPersistenceError) -> Error {
    Error::new("The Agent Run operation could not be completed.")
        .extend_with(|_, extension| extension.set("code", error.code_str()))
}
