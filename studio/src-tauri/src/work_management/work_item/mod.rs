//! Work Item mutation views.
//!
//! Work Item creation, update, reorder, and deletion remain authored because
//! they change an aggregate inside domain transactions. Their public GraphQL
//! plumbing lives with the fields that own it.

mod views;

pub(crate) fn register_mutations(builder: &mut seaography::Builder) {
    views::register(builder);
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn aggregate_views_preserve_the_create_and_delete_contracts() {
        let sdl = crate::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract");

        assert!(sdl.contains(
            "create_work_item(project_id: String!, name: String!, issue_type_id: String!, description: String, state_id: String, parent_id: String): WorktrackerIssue!"
        ));
        assert!(sdl.contains("delete_work_item(id: String!): Boolean!"));
    }

    #[tokio::test]
    async fn aggregate_views_preserve_authored_write_authorization() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        let schema = crate::query_root::generated_contract_schema(database).unwrap();

        for mutation in [
            r#"mutation {
                create_work_item(
                    project_id: "10000000-0000-0000-0000-000000000000",
                    name: "Task",
                    issue_type_id: "20000000-0000-0000-0000-000000000000"
                ) { id }
            }"#,
            r#"mutation {
                delete_work_item(id: "30000000-0000-0000-0000-000000000000")
            }"#,
        ] {
            let response = schema.execute(mutation).await;
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
}
