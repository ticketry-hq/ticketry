//! Authored deletion of one Work Item aggregate.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use crate::work_management::{
    commands::work_items,
    graphql::{command_database, command_error, work_facts},
};

pub(super) struct DeleteWorkItemMutation;

#[CustomFields]
impl DeleteWorkItemMutation {
    async fn delete_work_item(ctx: &Context<'_>, id: String) -> Result<bool> {
        work_items::delete(command_database(ctx)?, &id, work_facts(ctx))
            .await
            .map_err(command_error)?;
        Ok(true)
    }
}

pub(super) fn register(builder: &mut seaography::Builder) {
    builder.register_custom_mutation::<DeleteWorkItemMutation>();
}
