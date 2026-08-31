//! Authored reorder of one Work Item among its siblings.

#![allow(non_snake_case)]

use crate::graphql_scalars::StringList;
use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

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
    ) -> Result<crate::entities::work_management::issue::Model> {
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

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn preserves_the_reorder_contract_and_authorization() {
        let sdl = crate::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract");
        assert!(sdl.contains(
            "reorder_work_item(id: String!, before_id: String, after_id: String, initial_order_ids: [String!]): WorktrackerIssue!"
        ));

        let database = Database::connect("sqlite::memory:").await.unwrap();
        let schema = crate::query_root::generated_contract_schema(database).unwrap();
        let response = schema
            .execute(
                r#"mutation {
                    reorder_work_item(
                        id: "10000000-0000-0000-0000-000000000000",
                        after_id: "20000000-0000-0000-0000-000000000000"
                    ) { id }
                }"#,
            )
            .await;
        assert_eq!(response.errors.len(), 1);
        assert_eq!(
            response.errors[0]
                .extensions
                .as_ref()
                .and_then(|extensions| extensions.get("code")),
            Some(&Value::from("worktracker_write_unavailable"))
        );
    }
}
