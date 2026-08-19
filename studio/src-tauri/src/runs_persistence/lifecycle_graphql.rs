#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomOutputType,
};
use serde::Serialize;

use super::{
    AgentRunHolding, AuthenticatedAgentRun, LifecycleAcceptance, LifecycleFact,
    RunTerminationService, RunsPersistenceError, RunsServices, TerminationResult,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct CurrentRunTermination {
    pub agent_run_id: String,
    pub terminated: bool,
    pub already_terminated: bool,
    pub durable_fact_applied: bool,
}

impl From<TerminationResult> for CurrentRunTermination {
    fn from(value: TerminationResult) -> Self {
        Self {
            agent_run_id: value.agent_run_id,
            terminated: value.terminated,
            already_terminated: value.already_terminated,
            durable_fact_applied: value.durable_fact_applied,
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

    /// No target identifier is accepted. The principal is installed by the
    /// authenticated transport rather than parsed from GraphQL variables, so
    /// an unbound caller is rejected before any service is consulted. The
    /// desktop transport binds no Agent Run; agents reach termination through
    /// the authenticated MCP transport, which shares this service.
    async fn terminate_current_agent_run(ctx: &Context<'_>) -> Result<CurrentRunTermination> {
        let principal = principal(ctx)?;
        termination(ctx)?
            .terminate_current_run(principal)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<AgentRunHolding>();
    builder.register_custom_output::<LifecycleAccepted>();
    builder.register_custom_output::<CurrentRunTermination>();
    builder.register_custom_query::<AgentRunQueries>();
    builder.register_custom_mutation::<AgentRunMutations>();
    builder
}

fn services<'a>(ctx: &'a Context<'a>) -> Result<&'a RunsServices> {
    ready(ctx)?;
    ctx.data::<RunsServices>().map_err(|_| unavailable())
}

fn termination<'a>(ctx: &'a Context<'a>) -> Result<&'a RunTerminationService> {
    ready(ctx)?;
    ctx.data::<RunTerminationService>()
        .map_err(|_| unavailable())
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

fn principal<'a>(ctx: &'a Context<'a>) -> Result<&'a AuthenticatedAgentRun> {
    ctx.data::<AuthenticatedAgentRun>().map_err(|_| {
        Error::new("The current Agent Run is not authenticated.")
            .extend_with(|_, extension| extension.set("code", "caller_run_unbound"))
    })
}

fn unavailable() -> Error {
    Error::new("The Runs service is unavailable.")
        .extend_with(|_, extension| extension.set("code", "runs_unavailable"))
}

fn graphql_error(error: RunsPersistenceError) -> Error {
    Error::new("The Agent Run operation could not be completed.")
        .extend_with(|_, extension| extension.set("code", error.code_str()))
}
