//! Generated create-one view for Issue Type.
//!
//! The four generated operations remain independently audited:
//!
//! | Operation | Public fields | Identity/scope | Invariants | Decision |
//! | --- | --- | --- | --- | --- |
//! | Create one | `project_id`, `name`, `level`, `color` | one project-owned row | entity lifecycle supplies identity, defaults, ordering, validation, and timestamps | generated |
//! | Create batch | none | no owned caller | no batch contract is required | private |
//! | Update | `name`, `color`, `sort_order`, revisioned start-state change | generated filter is optional and may update many rows | concrete identity and workflow revision are required | private |
//! | Delete | none | generated filter is optional and may delete many rows | reassignment and protected references require a transaction | private |

mod serializer;

use seaography::Builder;
use seaolim::{register_generated_mutations, GeneratedMutations, ViewSerializers};

use crate::entities::work_management::issue_type;

use serializer::IssueTypeCreateSerializer;

pub(super) fn register(builder: &mut Builder) {
    register_generated_mutations::<issue_type::Entity, issue_type::ActiveModel>(
        builder,
        GeneratedMutations::CREATE_ONE,
        bindings(),
    );
}

fn bindings() -> ViewSerializers {
    ViewSerializers::default().serializer::<issue_type::ActiveModel, _>(IssueTypeCreateSerializer)
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, EntityTrait};

    use super::*;

    async fn generated_sdl() -> String {
        crate::graphql_foundation::generated_schema_sdl()
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

        let schema = crate::query_root::generated_contract_schema(database.clone()).unwrap();

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
