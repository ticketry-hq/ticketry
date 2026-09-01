//! Restricted update of one Issue Type.
//!
//! The generated update accepts an optional filter and can change many rows.
//! This view binds one identity, exposes only the existing patch fields, and
//! keeps the revisioned start-state repair inside Seaolim's transaction.

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

use crate::work_management::{commands::catalog, graphql};
use ticketry_entities::issue_type;

struct UpdateIssueType;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<issue_type::Entity, issue_type::ActiveModel> for UpdateIssueType {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<issue_type::ActiveModel, issue_type::Model>> {
        let active = catalog::prepare_issue_type_update(
            transaction,
            catalog::UpdateIssueType {
                id: ctx.args.try_get("id")?.string()?.to_owned(),
                name: optional_string(ctx, "name")?,
                color: optional_string(ctx, "color")?,
                sort_order: optional_i32(ctx, "sort_order")?,
                start_state_id: optional_string(ctx, "start_state_id")?,
                workflow_revision: optional_i32(ctx, "workflow_revision")?,
            },
        )
        .await
        .map_err(graphql::command_error)?;
        Ok(PreparedModelWrite::new(ModelWrite::Update(active), ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<issue_type::Entity, issue_type::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_issue_type", OperationType::Update)
            .argument(string_argument("id"))
            .argument(InputValue::new("name", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new("color", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new("sort_order", TypeRef::named(TypeRef::INT)))
            .argument(InputValue::new(
                "start_state_id",
                TypeRef::named(TypeRef::STRING),
            ))
            .argument(InputValue::new(
                "workflow_revision",
                TypeRef::named(TypeRef::INT),
            )),
        UpdateIssueType,
        ViewSerializers::default(),
    );
}

fn optional_string(ctx: &ResolverContext<'_>, name: &str) -> Result<Option<String>> {
    match ctx.args.get(name) {
        Some(value) if !value.is_null() => Ok(Some(value.string()?.to_owned())),
        _ => Ok(None),
    }
}

fn optional_i32(ctx: &ResolverContext<'_>, name: &str) -> Result<Option<i32>> {
    match ctx.args.get(name) {
        Some(value) if !value.is_null() => Ok(Some(value.i64()?.try_into()?)),
        _ => Ok(None),
    }
}
