#![allow(non_snake_case)]

//! Restricted upsert of one Module's local folder.

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Error, ErrorExtensions, Result,
    },
    Builder, CustomInputType, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};

use super::super::mutation_error::{require_write_ownership, store_error};
use crate::module_links::{
    entities::module_link, resolution, store::PreparedModuleLink, ModuleLinkStore,
};

/// The only caller-writable Module Link field.
///
/// Seaography reads this declaration to build the input type. The restricted
/// view parses the same value from the dynamic resolver context.
#[allow(dead_code)]
#[derive(Clone, Debug, CustomInputType)]
#[seaography(input_type_name = "ModuleLinkPathInput")]
struct ModuleLinkPathInput {
    pub path: String,
}

struct SetModuleLink;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<module_link::Entity, module_link::ActiveModel> for SetModuleLink {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<module_link::ActiveModel, module_link::Model>> {
        require_write_ownership(ctx)?;
        let module_id = ctx.args.try_get("module_id")?.string()?;
        let link = ctx.args.try_get("link")?.object()?;
        let path = link.try_get("path")?.string()?;

        crate::module_links::folder_preflight::validate_configured(Some(path.trim()))
            .map_err(|failure| folder_refusal(resolution::ModuleFolderRefusal::from(failure)))?;
        let write = match ModuleLinkStore::prepare_set(transaction, module_id, path)
            .await
            .map_err(store_error)?
        {
            PreparedModuleLink::Insert(row) => ModelWrite::Insert(row),
            PreparedModuleLink::Update(row) => ModelWrite::Update(row),
        };
        Ok(PreparedModelWrite::new(write, ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_input::<ModuleLinkPathInput>();
    register_restricted_model_mutation::<module_link::Entity, module_link::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("set_module_link", OperationType::Update)
            .argument(string_argument("module_id"))
            .argument(InputValue::new(
                "link",
                TypeRef::named_nn("ModuleLinkPathInput"),
            )),
        SetModuleLink,
        ViewSerializers::default(),
    );
}

fn folder_refusal(refusal: resolution::ModuleFolderRefusal) -> Error {
    let code = refusal.code();
    Error::new(refusal.message())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", refusal.message()))
}
