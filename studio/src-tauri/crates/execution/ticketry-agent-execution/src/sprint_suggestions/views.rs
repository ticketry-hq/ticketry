use super::{create, worker, SprintSuggestionExecutor};
use sea_orm::{DatabaseTransaction, EntityTrait, IntoActiveModel, Set};
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Error, ErrorExtensions, Result,
    },
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers, WritePermit,
};
use ticketry_entities::{agent_execution, sprint};

// Generated writes cannot bind sprint ownership, atomically create the run and
// snapshot, or fence cancellation against publication. Only these restricted
// model-shaped create/update seams are public; batch and delete stay private.
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
struct CancelExecution;
#[async_trait::async_trait]
impl RestrictedModelMutation<agent_execution::Entity, agent_execution::ActiveModel>
    for CancelExecution
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        txn: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<agent_execution::ActiveModel, agent_execution::Model>> {
        ctx.data::<SprintSuggestionExecutor>()?;
        if !ctx.args.try_get("cancel_requested")?.boolean()? {
            return Err(error("Only cancellation can be requested.".into()));
        }
        let id = create::compact(ctx.args.try_get("id")?.string()?).map_err(error)?;
        let project_id =
            create::compact(ctx.args.try_get("project_id")?.string()?).map_err(error)?;
        worker::lock(txn, &id)
            .await
            .map_err(|e| error(e.to_string()))?;
        let row = agent_execution::Entity::find_by_id(&id)
            .one(txn)
            .await?
            .ok_or_else(|| error("Execution not found.".into()))?;
        let sprint = sprint::Entity::find_by_id(&row.sprint_id)
            .one(txn)
            .await?
            .filter(|s| s.project_id == project_id)
            .ok_or_else(|| error("Execution not found in this project.".into()))?;
        let _ = sprint;
        let mut active = row.clone().into_active_model();
        if matches!(row.state.as_str(), "queued" | "running") {
            active.cancel_requested = Set(true);
            active.state = Set("cancelled".into());
            worker::end_run(
                txn,
                &row.agent_run_id,
                "cancelled",
                Some("Cancelled.".into()),
            )
            .await?;
        }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        Ok(PreparedModelWrite::new(ModelWrite::Update(active), ()))
    }
}
pub(super) fn register(mut builder: Builder) -> Builder {
    register_restricted_model_mutation::<agent_execution::Entity, agent_execution::ActiveModel, _>(
        &mut builder,
        RestrictedMutationField::new("agent_execution_create", OperationType::Create)
            .argument(string_argument("project_id"))
            .argument(string_argument("sprint_id"))
            .argument(string_argument("client_request_id"))
            .hook_owns_authorization(),
        CreateExecution,
        ViewSerializers::default(),
    );
    register_restricted_model_mutation::<agent_execution::Entity, agent_execution::ActiveModel, _>(
        &mut builder,
        RestrictedMutationField::new("agent_execution_update", OperationType::Update)
            .argument(string_argument("project_id"))
            .argument(string_argument("id"))
            .argument(InputValue::new(
                "cancel_requested",
                TypeRef::named_nn(TypeRef::BOOLEAN),
            ))
            .hook_owns_authorization(),
        CancelExecution,
        ViewSerializers::default(),
    );
    builder
}
fn error(detail: String) -> Error {
    Error::new(detail).extend_with(|_, e| {
        e.set("code", "sprint_execution_refused");
    })
}
