//! Delete one unprotected and unreferenced State.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{dynamic::ResolverContext, Result},
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};

use super::support::{work_facts, WakeWorkFacts};
use crate::work_management::{
    commands::state_configuration,
    graphql::{command_error, require_command_database},
};
use ticketry_entities::state;

struct DeleteState;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<state::Entity, state::ActiveModel> for DeleteState {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<state::ActiveModel, state::Model>> {
        require_command_database(ctx)?;
        let facts = work_facts(ctx);
        let (model, active_model) = state_configuration::prepare_state_delete(
            transaction,
            ctx.args.try_get("state_id")?.string()?,
            facts.as_ref(),
        )
        .await
        .map_err(command_error)?;
        Ok(PreparedModelWrite::new(
            ModelWrite::Delete {
                model,
                active_model,
            },
            WakeWorkFacts::new(facts),
        ))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<state::Entity, state::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("delete_state", OperationType::Delete)
            .argument(string_argument("state_id"))
            .hook_owns_authorization()
            .returns_boolean(),
        DeleteState,
        ViewSerializers::default(),
    );
}
