//! Authored reorder of one Work Item among its siblings.

#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};
use ticketry_entities::StringList;

use crate::work_management::{
    commands::reorder,
    graphql::{authoritative_work_item, command_database, command_error, work_facts},
};

pub(super) struct ReorderWorkItemMutation;

#[CustomFields]
impl ReorderWorkItemMutation {
    async fn reorder_work_item(
        ctx: &Context<'_>,
        id: String,
        before_id: Option<String>,
        after_id: Option<String>,
        initial_order_ids: Option<StringList>,
    ) -> Result<ticketry_entities::issue::Model> {
        let database = command_database(ctx)?;
        ticketry_diagnostics::record_story_move(
            "info",
            "graphql-reorder-requested",
            serde_json::json!({
                "id": id,
                "before_id": before_id,
                "after_id": after_id,
                "initial_order_ids": initial_order_ids.as_ref().map(|ids| &ids.0),
            }),
        );
        let result = reorder::reorder_work_item(
            database,
            reorder::ReorderWorkItem {
                id,
                before_id,
                after_id,
                initial_order_ids: initial_order_ids.map(|ids| ids.0),
            },
            work_facts(ctx),
        )
        .await;
        let id = match result {
            Ok(id) => {
                ticketry_diagnostics::record_story_move(
                    "info",
                    "graphql-reorder-succeeded",
                    serde_json::json!({"id": id}),
                );
                id
            }
            Err(error) => {
                ticketry_diagnostics::record_story_move(
                    "error",
                    "graphql-reorder-failed",
                    serde_json::json!({
                        "code": error.code(),
                        "field": error.field_name(),
                        "message": error.to_string(),
                        "debug": format!("{error:?}"),
                    }),
                );
                return Err(command_error(error));
            }
        };
        let authoritative = authoritative_work_item(database, &id).await;
        if let Err(error) = &authoritative {
            ticketry_diagnostics::record_story_move(
                "error",
                "graphql-reorder-readback-failed",
                serde_json::json!({"id": id, "message": error.message}),
            );
        }
        authoritative
    }
}

pub(super) fn register(builder: &mut seaography::Builder) {
    builder.register_custom_mutation::<ReorderWorkItemMutation>();
}
