#![allow(non_snake_case)]

//! The authored Run Now operation.
//!
//! Run Now is not model CRUD. It binds eligibility, a workflow transition,
//! durable launch preparation, and recovery to one request identity. Returning
//! refusals as data keeps committed-state reconciliation and remedies available
//! to Studio instead of collapsing them into transport errors.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomOutputType,
};

use super::{
    RunNowCaller, RunNowRefusal, RunNowRequest, RunNowRun, RunNowService, RunNowState,
    RunNowSuccess,
};

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct RunNowStatePayload {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct RunNowRunPayload {
    pub target_id: String,
    pub agent: String,
    pub agent_run_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct RunNowPayload {
    pub target_id: String,
    pub code: String,
    pub detail: String,
    pub remedy: Option<String>,
    pub committed_state: Option<RunNowStatePayload>,
    pub run: Option<RunNowRunPayload>,
}

impl From<RunNowState> for RunNowStatePayload {
    fn from(value: RunNowState) -> Self {
        Self {
            id: value.id,
            name: value.name,
        }
    }
}

impl From<RunNowRun> for RunNowRunPayload {
    fn from(value: RunNowRun) -> Self {
        Self {
            target_id: value.target_id,
            agent: value.agent,
            agent_run_id: value.agent_run_id,
        }
    }
}

impl From<RunNowSuccess> for RunNowPayload {
    fn from(value: RunNowSuccess) -> Self {
        Self {
            target_id: value.target_id,
            code: value.code,
            detail: value.detail,
            remedy: value.remedy,
            committed_state: Some(value.committed_state.into()),
            run: Some(value.run.into()),
        }
    }
}

impl From<RunNowRefusal> for RunNowPayload {
    fn from(value: RunNowRefusal) -> Self {
        Self {
            target_id: value.target_id,
            code: value.code,
            detail: value.detail,
            remedy: value.remedy,
            committed_state: value.committed_state.map(Into::into),
            run: value.run.map(Into::into),
        }
    }
}

pub struct RunNowMutations;

#[CustomFields]
impl RunNowMutations {
    async fn run_now(
        ctx: &Context<'_>,
        id_or_key: String,
        request_identity: String,
    ) -> Result<RunNowPayload> {
        let result = service(ctx)?
            .execute(RunNowRequest {
                id_or_key,
                request_identity,
                caller: RunNowCaller::Human,
            })
            .await;
        Ok(match result {
            Ok(success) => success.into(),
            Err(refusal) => refusal.into(),
        })
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    debug_assert_eq!(super::DOMAIN_OPERATIONS[0].field, "run_now");
    builder.register_custom_output::<RunNowStatePayload>();
    builder.register_custom_output::<RunNowRunPayload>();
    builder.register_custom_output::<RunNowPayload>();
    builder.register_custom_mutation::<RunNowMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a RunNowService> {
    ctx.data::<RunNowService>().map_err(|_| {
        Error::new("Run Now is unavailable.")
            .extend_with(|_, extension| extension.set("code", "run_now_unavailable"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusal_keeps_remedy_and_committed_state_without_a_run() {
        let payload = RunNowPayload::from(RunNowRefusal {
            target_id: "task-1".into(),
            code: "launch_unavailable".into(),
            detail: "Launch will be retried.".into(),
            remedy: Some("Wait for recovery.".into()),
            committed_state: Some(RunNowState {
                id: "implement".into(),
                name: "Implement".into(),
            }),
            run: None,
        });
        assert_eq!(payload.committed_state.unwrap().name, "Implement");
        assert_eq!(payload.remedy.as_deref(), Some("Wait for recovery."));
        assert!(payload.run.is_none());
    }
}
