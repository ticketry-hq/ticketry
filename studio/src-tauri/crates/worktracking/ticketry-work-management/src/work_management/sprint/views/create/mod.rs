//! Restricted Sprint create, retaining Seaography's generated input contract.

mod serializer;

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Result,
    },
    guard_error, prepare_active_model, Builder, BuilderContext, EntityCreateOneMutationBuilder,
    EntityInputBuilder, EntityObjectBuilder, GuardAction, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, ModelWrite, PreparedModelWrite, RestrictedModelMutation,
    RestrictedMutationField, ViewSerializers,
};

use ticketry_entities::sprint;

use crate::work_management::{
    commands::sprint_create, graphql::command_error, write_reservation::ReservedWrite,
};
use serializer::SprintCreateSerializer;

struct CreateSprint {
    context: &'static BuilderContext,
}

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<sprint::Entity, sprint::ActiveModel> for CreateSprint {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<sprint::ActiveModel, sprint::Model>> {
        let input = ctx
            .args
            .try_get(&self.context.entity_create_one_mutation.data_field)?
            .object()?;
        let object_builder = EntityObjectBuilder {
            context: self.context,
        };
        let entity_name = object_builder.type_name::<sprint::Entity>();
        for (column, _) in input.iter() {
            if let GuardAction::Block(reason) =
                self.context
                    .hooks
                    .field_guard(ctx, &entity_name, column, OperationType::Create)
            {
                return Err(guard_error(reason, "Field guard triggered."));
            }
        }
        let active = prepare_active_model::<sprint::Entity, sprint::ActiveModel>(
            &EntityInputBuilder {
                context: self.context,
            },
            &object_builder,
            &input,
        )?;
        let active = sprint_create::prepare(transaction, active)
            .await
            .map_err(command_error)?;
        Ok(PreparedModelWrite::new(ModelWrite::Insert(active), ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    let context = builder.context;
    let input_builder = EntityInputBuilder { context };
    builder
        .inputs
        .push(input_builder.insert_input_object::<sprint::Entity>());
    register_restricted_model_mutation::<sprint::Entity, sprint::ActiveModel, _>(
        builder,
        RestrictedMutationField::new(
            EntityCreateOneMutationBuilder { context }.type_name::<sprint::Entity>(),
            OperationType::Create,
        )
        .argument(InputValue::new(
            &context.entity_create_one_mutation.data_field,
            TypeRef::named_nn(input_builder.insert_type_name::<sprint::Entity>()),
        )),
        ReservedWrite(CreateSprint { context }),
        bindings(),
    );
}

fn bindings() -> ViewSerializers {
    ViewSerializers::default().serializer::<sprint::ActiveModel, _>(SprintCreateSerializer)
}
