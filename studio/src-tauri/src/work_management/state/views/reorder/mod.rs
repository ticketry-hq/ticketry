//! Replace one Project's complete State ordering.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Result,
    },
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_set_mutation, string_argument, ModelSetWrite, PreparedModelSet,
    RestrictedModelSetMutation, RestrictedMutationField, ViewSerializers,
};

use super::support::{work_facts, WakeWorkFacts};
use crate::work_management::{
    commands::catalog,
    graphql::{command_error, require_command_database},
};
use ticketry_entities::work_management::state;

struct ReorderStates;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelSetMutation<state::Entity, state::ActiveModel> for ReorderStates {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelSet<state::ActiveModel, state::Model>> {
        require_command_database(ctx)?;
        let project_id = ctx.args.try_get("project_id")?.string()?;
        let ordered_ids = ctx
            .args
            .try_get("ordered_ids")?
            .list()?
            .iter()
            .map(|value| value.string().map(str::to_owned))
            .collect::<Result<Vec<_>>>()?;
        let facts = work_facts(ctx);
        let writes =
            catalog::prepare_state_reorder(transaction, project_id, ordered_ids, facts.as_ref())
                .await
                .map_err(command_error)?
                .into_iter()
                .map(|(model, active_model)| ModelSetWrite::Update {
                    model,
                    active_model,
                })
                .collect();
        Ok(PreparedModelSet::new(writes, WakeWorkFacts::new(facts)))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_set_mutation::<state::Entity, state::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("reorder_states", OperationType::Update)
            .argument(string_argument("project_id"))
            .argument(InputValue::new(
                "ordered_ids",
                TypeRef::named_nn_list_nn(TypeRef::STRING),
            ))
            .hook_owns_authorization(),
        ReorderStates,
        ViewSerializers::default(),
    );
}
