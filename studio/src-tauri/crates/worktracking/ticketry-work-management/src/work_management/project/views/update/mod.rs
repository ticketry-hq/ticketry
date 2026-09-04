//! Allowlisted update of one concrete Project.

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

use super::support::optional_string;
use crate::work_management::{
    commands::catalog,
    graphql::{command_error, require_command_database},
};
use ticketry_entities::project;

struct UpdateProject;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<project::Entity, project::ActiveModel> for UpdateProject {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<project::ActiveModel, project::Model>> {
        require_command_database(ctx)?;
        let active = catalog::prepare_update_project(
            transaction,
            catalog::UpdateProject {
                id: ctx.args.try_get("id")?.string()?.to_owned(),
                name: optional_string(ctx, "name")?,
                description: optional_string(ctx, "description")?,
            },
        )
        .await
        .map_err(command_error)?;
        Ok(PreparedModelWrite::new(ModelWrite::Update(active), ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<project::Entity, project::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_project", OperationType::Update)
            .argument(string_argument("id"))
            .argument(InputValue::new("name", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new(
                "description",
                TypeRef::named(TypeRef::STRING),
            ))
            .hook_owns_authorization(),
        UpdateProject,
        ViewSerializers::default(),
    );
}
