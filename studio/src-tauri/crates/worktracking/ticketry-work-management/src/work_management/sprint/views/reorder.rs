//! Authored move between concrete identities in the project Sprint sequence.

use crate::work_management::{
    commands::sprint_reorder,
    graphql::{command_database, command_error, work_facts},
};
use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};
use ticketry_entities::sprint;

struct ReorderSprint;

#[CustomFields]
impl ReorderSprint {
    async fn reorder_sprint(
        ctx: &Context<'_>,
        sprint_id: String,
        before_id: Option<String>,
        after_id: Option<String>,
    ) -> Result<sprint::Model> {
        sprint_reorder::reorder_sprint(
            command_database(ctx)?,
            &sprint_id,
            before_id,
            after_id,
            work_facts(ctx),
        )
        .await
        .map_err(command_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<ReorderSprint>();
}
