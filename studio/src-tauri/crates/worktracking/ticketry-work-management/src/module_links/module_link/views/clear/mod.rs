//! Idempotent deletion of one Module's local folder.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{dynamic::ResolverContext, Result},
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};

use super::super::mutation_error::{require_write_ownership, store_error};
use crate::module_links::{entities::module_link, store};

struct ClearModuleLink;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<module_link::Entity, module_link::ActiveModel> for ClearModuleLink {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<module_link::ActiveModel, module_link::Model>> {
        require_write_ownership(ctx)?;
        let module_id = ctx.args.try_get("module_id")?.string()?;
        let write = match store::find(transaction, module_id)
            .await
            .map_err(store_error)?
        {
            Some(model) => ModelWrite::Delete {
                active_model: model.clone().into(),
                model,
            },
            None => ModelWrite::Noop,
        };
        Ok(PreparedModelWrite::new(write, ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<module_link::Entity, module_link::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("clear_module_link", OperationType::Delete)
            .argument(string_argument("module_id"))
            .returns_boolean(),
        ClearModuleLink,
        ViewSerializers::default(),
    );
}
