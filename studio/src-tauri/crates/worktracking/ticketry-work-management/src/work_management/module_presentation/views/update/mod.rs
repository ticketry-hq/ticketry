use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, IntoActiveModel, QueryFilter, Set};
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

use crate::work_management::{commands, graphql};
use ticketry_entities::{issue, module_presentation};

struct UpdateModulePresentation;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<module_presentation::Entity, module_presentation::ActiveModel>
    for UpdateModulePresentation
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<module_presentation::ActiveModel, module_presentation::Model>>
    {
        let module_id =
            commands::database_uuid(ctx.args.try_get("module_id")?.string()?, "module_id")
                .map_err(graphql::command_error)?;
        let tab_hidden = ctx.args.try_get("tab_hidden")?.boolean()?;

        let module = issue::Entity::find_by_id(&module_id)
            .filter(issue::Column::Type.eq("module"))
            .one(transaction)
            .await
            .map_err(commands::CommandError::from)
            .map_err(graphql::command_error)?
            .ok_or_else(|| {
                graphql::command_error(commands::CommandError::NotFound(
                    "Module not found.".to_owned(),
                ))
            })?;
        let presentation = module_presentation::Entity::find_by_id(&module.id)
            .one(transaction)
            .await
            .map_err(commands::CommandError::from)
            .map_err(graphql::command_error)?;

        let write = match presentation {
            Some(row) => {
                let mut active = row.into_active_model();
                active.tab_hidden = Set(tab_hidden);
                ModelWrite::Update(active)
            }
            None => ModelWrite::Insert(module_presentation::ActiveModel {
                module_id: Set(module.id),
                rank: Set(String::new()),
                tab_hidden: Set(tab_hidden),
            }),
        };
        Ok(PreparedModelWrite::new(write, ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<
        module_presentation::Entity,
        module_presentation::ActiveModel,
        _,
    >(
        builder,
        RestrictedMutationField::new("update_module_presentation", OperationType::Update)
            .argument(string_argument("module_id"))
            .argument(InputValue::new(
                "tab_hidden",
                TypeRef::named_nn(TypeRef::BOOLEAN),
            )),
        UpdateModulePresentation,
        ViewSerializers::default(),
    );
}
