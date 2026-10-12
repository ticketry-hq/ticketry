//! Review one sprint suggestion: accept, dismiss or restore it.

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
use ticketry_entities::sprint_suggestion;

use crate::work_management::{
    commands::{sprint_suggestions, status_facts::WorkFactRecorder, workflow::PatchValue},
    graphql::{command_error, require_command_database},
};

struct UpdateSuggestion;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<sprint_suggestion::Entity, sprint_suggestion::ActiveModel>
    for UpdateSuggestion
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<sprint_suggestion::ActiveModel, sprint_suggestion::Model>> {
        require_command_database(ctx)?;
        let facts = ctx.data_opt::<WorkFactRecorder>().cloned();
        let name = match ctx.args.get("proposed_name") {
            None => PatchValue::Unset,
            // A full mutation may pass null for the omitted optional name.
            Some(value) if value.is_null() => PatchValue::Unset,
            Some(value) => PatchValue::Value(value.string()?.to_owned()),
        };
        let active = sprint_suggestions::set_status(
            transaction,
            ctx.args.try_get("id")?.string()?,
            ctx.args.try_get("status")?.string()?,
            name,
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

struct WakeWorkFacts(Option<WorkFactRecorder>);
impl WritePermit for WakeWorkFacts {
    fn committed(self: Box<Self>) {
        if let Some(facts) = self.0 {
            facts.wake();
        }
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<
        sprint_suggestion::Entity,
        sprint_suggestion::ActiveModel,
        _,
    >(
        builder,
        RestrictedMutationField::new("update_sprint_suggestion", OperationType::Update)
            .argument(string_argument("id"))
            .argument(string_argument("status"))
            .argument(InputValue::new(
                "proposed_name",
                TypeRef::named(TypeRef::STRING),
            ))
            .hook_owns_authorization(),
        UpdateSuggestion,
        ViewSerializers::default(),
    );
}
