//! Authored creation of one Work Item aggregate.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use crate::work_management::{
    commands::work_items,
    graphql::{authoritative_work_item, command_database, command_error, work_facts},
};

pub(super) struct CreateWorkItemMutation;

#[CustomFields]
impl CreateWorkItemMutation {
    async fn create_work_item(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        issue_type_id: String,
        description: Option<String>,
        state_id: Option<String>,
        parent_id: Option<String>,
    ) -> Result<ticketry_entities::issue::Model> {
        let database = command_database(ctx)?;
        let id = work_items::create(
            database,
            work_items::CreateWorkItem {
                project_id,
                name,
                issue_type_id,
                description,
                state_id,
                parent_id,
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }
}

pub(super) fn register(builder: &mut seaography::Builder) {
    builder.register_custom_mutation::<CreateWorkItemMutation>();
}
