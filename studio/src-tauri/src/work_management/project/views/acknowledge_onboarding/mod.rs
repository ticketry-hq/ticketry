//! Acknowledge onboarding for one concrete Project.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{dynamic::ResolverContext, Result},
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};

use crate::{
    entities::work_management::project,
    work_management::{
        commands::catalog,
        graphql::{command_error, require_command_database},
    },
};

struct AcknowledgeOnboarding;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<project::Entity, project::ActiveModel> for AcknowledgeOnboarding {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<project::ActiveModel, project::Model>> {
        require_command_database(ctx)?;
        let project_id = ctx.args.try_get("project_id")?.string()?;
        let active = catalog::prepare_acknowledge_onboarding(transaction, project_id)
            .await
            .map_err(command_error)?;
        Ok(PreparedModelWrite::new(ModelWrite::Update(active), ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<project::Entity, project::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("acknowledge_onboarding", OperationType::Update)
            .argument(string_argument("project_id"))
            .hook_owns_authorization(),
        AcknowledgeOnboarding,
        ViewSerializers::default(),
    );
}
