//! Schema contracts the work-management views register.
//!
//! These assert against the composed contract — the generated SDL and the
//! authored write authorization on the assembled schema — which is built above
//! every slice. They live here rather than inside work management because a
//! crate cannot depend on the schema assembled out of it.

#[path = "work_management_schema/issue_type_views.rs"]
mod issue_type_views;
#[path = "work_management_schema/module_presentation_commands.rs"]
mod module_presentation_commands;
#[path = "work_management_schema/project_aggregate_create.rs"]
mod project_aggregate_create;
#[path = "work_management_schema/project_aggregate_delete.rs"]
mod project_aggregate_delete;
#[path = "work_management_schema/state_views.rs"]
mod state_views;

mod work_item_aggregate {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn aggregate_views_preserve_the_create_and_delete_contracts() {
        let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
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
        let schema =
            ticketry_graphql_schema::query_root::generated_contract_schema(database).unwrap();

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

mod project_views {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn project_views_keep_the_existing_contracts() {
        let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
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
        let schema =
            ticketry_graphql_schema::query_root::generated_contract_schema(database).unwrap();

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

mod work_item_reorder {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn preserves_the_reorder_contract_and_authorization() {
        let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract");
        assert!(sdl.contains(
            "reorder_work_item(id: String!, before_id: String, after_id: String, initial_order_ids: [String!]): WorktrackerIssue!"
        ));

        let database = Database::connect("sqlite::memory:").await.unwrap();
        let schema =
            ticketry_graphql_schema::query_root::generated_contract_schema(database).unwrap();
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

mod issue_type_create {
    use sea_orm::{ConnectionTrait, Database, EntityTrait};

    use ticketry_entities::work_management::issue_type;

    async fn generated_sdl() -> String {
        ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract")
    }

    #[tokio::test]
    async fn exposes_only_the_audited_create_one_contract() {
        let sdl = generated_sdl().await;

        assert!(sdl.contains("worktrackerIssuetypeCreateOne"));
        for operation in ["CreateBatch", "Update", "Delete"] {
            assert!(!sdl.contains(&format!("worktrackerIssuetype{operation}(")));
        }

        let insert = sdl
            .split("input WorktrackerIssuetypeInsertInput {")
            .nth(1)
            .expect("Issue Type insert input")
            .split('}')
            .next()
            .unwrap();
        for field in [
            "projectId: String!",
            "name: String!",
            "level: String!",
            "color: String",
        ] {
            assert!(insert.contains(field), "missing {field} from {insert}");
        }
        for field in [
            "id:",
            "sortOrder:",
            "startStateId:",
            "workflowRevision:",
            "isPathfind:",
            "createdAt:",
            "updatedAt:",
        ] {
            assert!(!insert.contains(field), "exposed {field} in {insert}");
        }
    }

    #[tokio::test]
    async fn view_serializer_preserves_the_checked_in_sdl() {
        let expected = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../src/graphql-foundation/generated/schema.graphql"),
        )
        .expect("read checked-in GraphQL schema");

        assert_eq!(generated_sdl().await, expected);
    }

    #[tokio::test]
    async fn preserves_defaults_null_color_uniqueness_and_level_ordering() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                r#"
                    CREATE TABLE worktracker_project (
                        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
                        description TEXT NOT NULL, seq_counter INTEGER NOT NULL,
                        state_revision INTEGER NOT NULL, manual_module_order BOOLEAN NOT NULL,
                        created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
                        onboarding_required BOOLEAN NOT NULL
                    );
                    CREATE TABLE worktracker_issuetype (
                        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                        level TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                        start_state_id TEXT, workflow_revision INTEGER NOT NULL,
                        is_pathfind BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
                        updated_at DATETIME NOT NULL,
                        UNIQUE(project_id, name)
                    );
                    INSERT INTO worktracker_project VALUES (
                        '10000000000000000000000000000000', 'Ticketry', 'TIC', '', 0, 0, 0,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
                    );
                    INSERT INTO worktracker_issuetype VALUES
                        ('20000000000000000000000000000001',
                         '10000000000000000000000000000000', 'Story', 'task', '', 0,
                         NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                        ('20000000000000000000000000000002',
                         '10000000000000000000000000000000', 'Task', 'task', '', 2,
                         NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                        ('20000000000000000000000000000003',
                         '10000000000000000000000000000000', 'Epic', 'module', '', 4,
                         NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
                "#,
            )
            .await
            .unwrap();

        let schema =
            ticketry_graphql_schema::query_root::generated_contract_schema(database.clone())
                .unwrap();

        let omitted = schema
            .execute(
                r#"mutation {
                    worktrackerIssuetypeCreateOne(data: {
                        projectId: "10000000-0000-0000-0000-000000000000",
                        name: "Implementation",
                        level: "task"
                    }) {
                        id color sortOrder startStateId workflowRevision isPathfind
                        createdAt updatedAt
                    }
                }"#,
            )
            .await;
        assert!(omitted.errors.is_empty(), "{:?}", omitted.errors);
        let omitted = serde_json::to_value(omitted.data).unwrap();
        let created = &omitted["worktrackerIssuetypeCreateOne"];
        assert_eq!(created["color"], "");
        assert_eq!(created["sortOrder"], 3);
        assert!(created["startStateId"].is_null());
        assert_eq!(created["workflowRevision"], 0);
        assert_eq!(created["isPathfind"], false);
        assert!(created["createdAt"].is_string());
        assert!(created["updatedAt"].is_string());

        let null_color = schema
            .execute(
                r#"mutation {
                    worktrackerIssuetypeCreateOne(data: {
                        projectId: "10000000000000000000000000000000",
                        name: "Initiative",
                        level: "module",
                        color: null
                    }) { color sortOrder }
                }"#,
            )
            .await;
        assert!(null_color.errors.is_empty(), "{:?}", null_color.errors);
        let null_color = serde_json::to_value(null_color.data).unwrap();
        assert_eq!(null_color["worktrackerIssuetypeCreateOne"]["color"], "");
        assert_eq!(null_color["worktrackerIssuetypeCreateOne"]["sortOrder"], 5);

        let duplicate = schema
            .execute(
                r#"mutation {
                    worktrackerIssuetypeCreateOne(data: {
                        projectId: "10000000000000000000000000000000",
                        name: "Implementation",
                        level: "task"
                    }) { id }
                }"#,
            )
            .await;
        assert_eq!(duplicate.errors.len(), 1);
        assert!(duplicate.errors[0]
            .message
            .contains("Issue type 'Implementation' already exists."));
        assert_eq!(
            issue_type::Entity::find()
                .all(&database)
                .await
                .unwrap()
                .len(),
            5
        );
    }
}

mod work_item_update {
    use sea_orm::Database;
    use seaography::async_graphql::Value;

    #[tokio::test]
    async fn preserves_the_public_update_contract_and_authorization() {
        let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated contract");
        assert!(sdl.contains(
            "update_work_item(id: String!, name: String, description: String, issue_type_id: String, state_id: String, parent_id: String, blocked_by_ids: [String!], is_archived: Boolean, workspace_tab_order: Json): WorktrackerIssue!"
        ));

        let database = Database::connect("sqlite::memory:").await.unwrap();
        let schema =
            ticketry_graphql_schema::query_root::generated_contract_schema(database).unwrap();
        let response = schema
            .execute(
                r#"mutation {
                    update_work_item(
                        id: "10000000-0000-0000-0000-000000000000",
                        name: "Renamed"
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

mod module_presentation_migration {
    #[tokio::test]
    async fn generated_contract_has_reads_and_relations_but_no_public_writes_or_project_flag() {
        let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
            .await
            .expect("build generated schema");
        let presentation = sdl
            .split("type WorktrackerModulepresentation {")
            .nth(1)
            .and_then(|value| value.split('}').next())
            .expect("ModulePresentation output type");
        assert!(presentation.contains("moduleId: String!"));
        assert!(presentation.contains("rank: String!"));
        assert!(presentation.contains("tabHidden: Boolean!"));
        assert!(presentation.contains("module: WorktrackerIssue"));

        let project = sdl
            .split("type WorktrackerProject {")
            .nth(1)
            .and_then(|value| value.split('}').next())
            .expect("Project output type");
        assert!(!project.contains("manualModuleOrder"));
        assert!(!sdl.contains("worktrackerModulepresentationCreate"));
        assert!(!sdl.contains("worktrackerModulepresentationUpdate"));
        assert!(!sdl.contains("worktrackerModulepresentationDelete"));
    }
}
