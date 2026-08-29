#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use super::commands::{module_presentation, reorder};
use super::read_types as output;
use super::support::{
    authoritative_module_presentation, command_database, command_error, work_facts,
};

pub struct ModulePresentationMutations;

#[CustomFields]
impl ModulePresentationMutations {
    async fn update_module_presentation(
        ctx: &Context<'_>,
        module_id: String,
        tab_hidden: bool,
    ) -> Result<super::entities::module_presentation::Model> {
        module_presentation::update(
            command_database(ctx)?,
            module_presentation::UpdateModulePresentation {
                module_id,
                tab_hidden,
            },
        )
        .await
        .map_err(command_error)
    }

    async fn reorder_module_presentation(
        ctx: &Context<'_>,
        module_id: String,
        before_id: Option<String>,
        after_id: Option<String>,
        initial_order_ids: Option<output::StringList>,
    ) -> Result<super::entities::module_presentation::Model> {
        let database = command_database(ctx)?;
        let module_id = reorder::reorder_module_presentation(
            database,
            reorder::ReorderWorkItem {
                id: module_id,
                before_id,
                after_id,
                initial_order_ids: initial_order_ids.map(|ids| ids.0),
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_module_presentation(database, &module_id).await
    }
}
