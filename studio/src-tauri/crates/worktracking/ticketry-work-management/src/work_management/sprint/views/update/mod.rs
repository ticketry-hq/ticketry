//! Update the allowlisted fields of one concrete Sprint, including its
//! lifecycle status.

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
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers, WritePermit,
};

use crate::work_management::{
    commands::{sprints, status_facts::WorkFactRecorder, workflow::PatchValue},
    graphql::{command_error, require_command_database},
};
use ticketry_entities::sprint;

struct UpdateSprint;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<sprint::Entity, sprint::ActiveModel> for UpdateSprint {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<sprint::ActiveModel, sprint::Model>> {
        require_command_database(ctx)?;
        let facts = ctx.data_opt::<WorkFactRecorder>().cloned();
        let active = sprints::prepare_sprint_update(
            transaction,
            sprints::UpdateSprint {
                id: ctx.args.try_get("id")?.string()?.to_owned(),
                name: patch_string(ctx, "name")?,
                suggestion_run_id: patch_string(ctx, "suggestion_run_id")?,
                status: patch_string(ctx, "status")?,
                carryover_sprint_id: patch_string(ctx, "carryover_sprint_id")?,
            },
            facts.as_ref(),
        )
        .await
        .map_err(command_error)?;
        Ok(PreparedModelWrite::new(
            ModelWrite::Update(active),
            WakeWorkFacts(facts),
        ))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<sprint::Entity, sprint::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_sprint", OperationType::Update)
            .argument(string_argument("id"))
            .argument(InputValue::new("name", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new(
                "suggestion_run_id",
                TypeRef::named(TypeRef::STRING),
            ))
            .argument(InputValue::new("status", TypeRef::named(TypeRef::STRING)))
            .argument(InputValue::new(
                "carryover_sprint_id",
                TypeRef::named(TypeRef::STRING),
            ))
            .hook_owns_authorization(),
        UpdateSprint,
        ViewSerializers::default(),
    );
}

/// Preserves `omitted | null | value` for clearable columns.
fn patch_string(ctx: &ResolverContext<'_>, name: &str) -> Result<PatchValue<String>> {
    Ok(match ctx.args.get(name) {
        None => PatchValue::Unset,
        Some(value) if value.is_null() => PatchValue::Null,
        Some(value) => PatchValue::Value(value.string()?.to_owned()),
    })
}

struct WakeWorkFacts(Option<WorkFactRecorder>);

impl WritePermit for WakeWorkFacts {
    fn committed(self: Box<Self>) {
        if let Some(facts) = self.0.as_ref() {
            facts.wake();
        }
    }
}
