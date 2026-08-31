//! Authored reorder of the project-owned Module Presentation set.
//!
//! First drag seeds the complete active Module set under the Project lock, so
//! generated per-row CRUD cannot preserve the operation's atomic contract.

use sea_orm::EntityTrait;
use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::entities::work_management::module_presentation;
use crate::graphql_scalars::StringList;
use crate::work_management::{
    commands::{reorder, CommandError},
    graphql::{command_database, command_error, work_facts},
};

struct ReorderModulePresentationView;

#[CustomFields]
impl ReorderModulePresentationView {
    async fn reorder_module_presentation(
        ctx: &Context<'_>,
        module_id: String,
        before_id: Option<String>,
        after_id: Option<String>,
        initial_order_ids: Option<StringList>,
    ) -> Result<module_presentation::Model> {
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
        module_presentation::Entity::find_by_id(module_id.replace('-', ""))
            .one(database)
            .await
            .map_err(CommandError::from)
            .map_err(command_error)?
            .ok_or_else(|| {
                command_error(CommandError::NotFound(
                    "Module presentation not found.".to_owned(),
                ))
            })
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<ReorderModulePresentationView>();
}
