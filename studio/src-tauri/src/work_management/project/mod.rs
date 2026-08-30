//! Project mutation views.
//!
//! Generated Project writes remain private as one audited contract:
//!
//! | Operation | Public fields | Identity and invariants | Decision |
//! | --- | --- | --- | --- |
//! | Create one | `name`, `slug`, `description` | seeds the Project catalogue in one aggregate transaction | authored aggregate remains at `create_project` |
//! | Create batch | none | no caller contract exists | private |
//! | Update | `name`, `description`; acknowledgement writes only `onboarding_required` | both fields require one concrete Project identity and authored command ownership | restricted Seaolim views |
//! | Delete | none | tears down WorkItems before protected catalogue rows | authored aggregate remains at `delete_project` |
//!
//! Generated update cannot express the two distinct allowlists while binding
//! one required identity. These views prepare one Project ActiveModel each;
//! Seaolim owns their transaction and persistence.

mod views;

#[cfg(test)]
mod aggregate_create_tests;
#[cfg(test)]
mod aggregate_delete_tests;

use seaography::Builder;

pub(super) fn register_mutations(mut builder: Builder) -> Builder {
    views::register_model_mutations(&mut builder);
    builder
}

pub(crate) fn register_authored_mutations(builder: &mut Builder) {
    views::register_authored_mutations(builder);
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn project_views_keep_the_existing_contracts() {
        let sdl = crate::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract");

        assert!(sdl.contains("acknowledge_onboarding(project_id: String!): WorktrackerProject!"));
        assert!(sdl.contains(
            "create_project(name: String!, slug: String!, description: String): WorktrackerProject!"
        ));
        assert!(sdl.contains("delete_project(id: String!): Boolean!"));
        assert!(sdl.contains(
            "update_project(id: String!, name: String, description: String): WorktrackerProject!"
        ));
        assert!(!sdl.contains("update_project(id: String!, slug:"));
        assert!(!sdl.contains("update_project(id: String!, onboarding_required:"));
    }

    #[tokio::test]
    async fn project_views_preserve_authored_write_authorization() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        let schema = crate::query_root::generated_contract_schema(database).unwrap();

        for mutation in [
            r#"mutation { acknowledge_onboarding(project_id: "10000000-0000-0000-0000-000000000000") { id } }"#,
            r#"mutation { create_project(name: "Ticketry", slug: "TIC") { id } }"#,
            r#"mutation { delete_project(id: "10000000-0000-0000-0000-000000000000") }"#,
            r#"mutation { update_project(id: "10000000-0000-0000-0000-000000000000", name: "Ticketry") { id } }"#,
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
