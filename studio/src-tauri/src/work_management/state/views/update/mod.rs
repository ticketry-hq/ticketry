//! Update the allowlisted fields of one concrete State.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Result,
    },
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};

use super::support::{optional_i32, optional_string, work_facts, WakeWorkFacts};
use crate::{
    entities::work_management::state,
    work_management::{
        commands::catalog,
        graphql::{command_error, require_command_database},
    },
};

struct UpdateState;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<state::Entity, state::ActiveModel> for UpdateState {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<state::ActiveModel, state::Model>> {
        require_command_database(ctx)?;
        let facts = work_facts(ctx);
        let active = catalog::prepare_state_update(
            transaction,
            catalog::UpdateState {
                id: ctx.args.try_get("id")?.string()?.to_owned(),
                name: optional_string(ctx, "name")?,
                group: optional_string(ctx, "group")?,
                color: optional_string(ctx, "color")?,
                sort_order: optional_i32(ctx, "sort_order")?,
            },
            facts.as_ref(),
        )
        .await
        .map_err(command_error)?;
        Ok(PreparedModelWrite::new(
            ModelWrite::Update(active),
            WakeWorkFacts::new(facts),
        ))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<state::Entity, state::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_state", OperationType::Update)
            .argument(string_argument("id"))
            .argument(InputValue::new("name", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new("group", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new("color", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new("sort_order", TypeRef::named(TypeRef::INT)))
            .hook_owns_authorization(),
        UpdateState,
        ViewSerializers::default(),
    );
}
