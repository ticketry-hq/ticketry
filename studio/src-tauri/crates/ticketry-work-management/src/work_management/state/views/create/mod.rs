//! Create one project-owned State with authored color and order allocation.

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

use super::support::{optional_string, work_facts, WakeWorkFacts};
use crate::work_management::{
    commands::catalog,
    graphql::{command_error, require_command_database},
};
use ticketry_entities::work_management::state;

struct CreateState;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<state::Entity, state::ActiveModel> for CreateState {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<state::ActiveModel, state::Model>> {
        require_command_database(ctx)?;
        let facts = work_facts(ctx);
        let active = catalog::prepare_state_create(
            transaction,
            catalog::CreateState {
                project_id: ctx.args.try_get("project_id")?.string()?.to_owned(),
                name: ctx.args.try_get("name")?.string()?.to_owned(),
                group: ctx.args.try_get("group")?.string()?.to_owned(),
                color: optional_string(ctx, "color")?,
            },
            facts.as_ref(),
        )
        .await
        .map_err(command_error)?;
        Ok(PreparedModelWrite::new(
            ModelWrite::Insert(active),
            WakeWorkFacts::new(facts),
        ))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<state::Entity, state::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("create_state", OperationType::Create)
            .argument(string_argument("project_id"))
            .argument(string_argument("name"))
            .argument(string_argument("group"))
            .argument(InputValue::new("color", TypeRef::named(TypeRef::STRING)))
            .hook_owns_authorization(),
        CreateState,
        ViewSerializers::default(),
    );
}
