//! Create one sprint-suggestion Agent Execution and dispatch it after commit.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{dynamic::ResolverContext, Result},
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers, WritePermit,
};
use ticketry_entities::agent_execution;

use super::support::error;
use crate::sprint_suggestions::{create, worker, SprintSuggestionExecutor};

struct CreateExecution;
#[async_trait::async_trait]
impl RestrictedModelMutation<agent_execution::Entity, agent_execution::ActiveModel>
    for CreateExecution
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        txn: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<agent_execution::ActiveModel, agent_execution::Model>> {
        let service = ctx.data::<SprintSuggestionExecutor>()?.clone();
        service.executable().map_err(error)?;
        let active = create::prepare(
            txn,
            ctx.args.try_get("project_id")?.string()?,
            ctx.args.try_get("sprint_id")?.string()?,
            ctx.args.try_get("client_request_id")?.string()?,
        )
        .await
        .map_err(error)?;
        let write = if active.id.is_set() && active.client_request_id.is_set() {
            ModelWrite::Insert(active)
        } else {
            ModelWrite::Update(active)
        };
        Ok(PreparedModelWrite::new(write, Dispatch(service)))
    }
}
struct Dispatch(SprintSuggestionExecutor);
impl WritePermit for Dispatch {
    fn committed(self: Box<Self>) {
        let service = self.0;
        tokio::spawn(async move {
            worker::dispatch(service).await;
        });
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<agent_execution::Entity, agent_execution::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("agent_execution_create", OperationType::Create)
            .argument(string_argument("project_id"))
            .argument(string_argument("sprint_id"))
            .argument(string_argument("client_request_id"))
            .hook_owns_authorization(),
        CreateExecution,
        ViewSerializers::default(),
    );
}
