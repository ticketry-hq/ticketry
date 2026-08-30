use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, EntityTrait};

use crate::entities::work_management::{issue_type, issue_type_transition, launch_binding};

const PROJECT: &str = "10000000000000000000000000000000";
const FOREIGN_PROJECT: &str = "10000000000000000000000000000009";
const FIRST_TYPE: &str = "20000000000000000000000000000001";
const SECOND_TYPE: &str = "20000000000000000000000000000002";
const FOREIGN_TYPE: &str = "20000000000000000000000000000009";
const FIRST_STATE: &str = "30000000000000000000000000000001";
const SECOND_STATE: &str = "30000000000000000000000000000002";
const FOREIGN_STATE: &str = "30000000000000000000000000000009";

async fn fixture() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE worktracker_project (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
                description TEXT NOT NULL, seq_counter INTEGER NOT NULL,
                state_revision INTEGER NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL, onboarding_required BOOLEAN NOT NULL
            );
            CREATE TABLE worktracker_state (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                "group" TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                is_protected BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                level TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                start_state_id TEXT, workflow_revision INTEGER NOT NULL,
                is_pathfind BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL, UNIQUE(project_id, name)
            );
            CREATE TABLE worktracker_issuetypetransition (
                id INTEGER PRIMARY KEY, issue_type_id TEXT NOT NULL,
                from_state_id TEXT NOT NULL, to_state_id TEXT NOT NULL,
                agent_allowed BOOLEAN NOT NULL
            );
            CREATE TABLE worktracker_launchbinding (
                id INTEGER PRIMARY KEY, issue_type_id TEXT NOT NULL, state_id TEXT NOT NULL,
                prompt TEXT NOT NULL, required_skills JSON NOT NULL, model_id TEXT,
                reasoning_id TEXT, auto_start BOOLEAN NOT NULL,
                subtree_run_enabled BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Project', 'PRJ', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
                ('{FOREIGN_PROJECT}', 'Foreign', 'FOR', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{FIRST_STATE}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{SECOND_STATE}', '{PROJECT}', 'Ready', 'started', '', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{FOREIGN_STATE}', '{FOREIGN_PROJECT}', 'Foreign', 'started', '', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{FIRST_TYPE}', '{PROJECT}', 'Task', 'task', '#111111', 0, '{FIRST_STATE}', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{SECOND_TYPE}', '{PROJECT}', 'Story', 'task', '#222222', 1, '{FIRST_STATE}', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{FOREIGN_TYPE}', '{FOREIGN_PROJECT}', 'Foreign', 'task', '#999999', 7, '{FOREIGN_STATE}', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition VALUES
                (1, '{FIRST_TYPE}', '{FIRST_STATE}', '{SECOND_STATE}', 1);
            INSERT INTO worktracker_launchbinding VALUES
                (1, '{FIRST_TYPE}', '{FIRST_STATE}', '', '[]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (2, '{FIRST_TYPE}', '{SECOND_STATE}', '', '[]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        ))
        .await
        .unwrap();
    database
}

fn schema(database: DatabaseConnection) -> seaography::async_graphql::dynamic::Schema {
    crate::query_root::generated_contract_schema(database).unwrap()
}

#[tokio::test]
async fn preserves_the_update_delete_and_reorder_sdl() {
    let sdl = crate::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build generated contract");
    assert!(sdl.contains(
        "update_issue_type(id: String!, name: String, color: String, sort_order: Int, start_state_id: String, workflow_revision: Int): WorktrackerIssuetype!"
    ));
    assert!(sdl.contains(
        "reorder_issue_types(project_id: String!, ordered_ids: [String!]!): [WorktrackerIssuetype!]!"
    ));
    assert!(sdl.contains("delete_issue_type(id: String!, reassign_to: String): Boolean!"));
}

#[tokio::test]
async fn update_rolls_back_revision_and_membership_repairs_on_late_failure() {
    let database = fixture().await;
    let response = schema(database.clone())
        .execute(format!(
            r#"mutation {{
                update_issue_type(
                    id: "{FIRST_TYPE}", name: "Story",
                    start_state_id: "{SECOND_STATE}", workflow_revision: 1
                ) {{ id }}
            }}"#
        ))
        .await;
    assert_eq!(response.errors.len(), 1);

    let row = issue_type::Entity::find_by_id(FIRST_TYPE)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.name, "Task");
    assert_eq!(row.start_state_id.as_deref(), Some(FIRST_STATE));
    assert_eq!(row.workflow_revision, 1);
    assert_eq!(
        issue_type_transition::Entity::find()
            .all(&database)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        launch_binding::Entity::find()
            .all(&database)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn update_rejects_foreign_start_state_without_committing_other_fields() {
    let database = fixture().await;
    let response = schema(database.clone())
        .execute(format!(
            r##"mutation {{
                update_issue_type(
                    id: "{FIRST_TYPE}", color: "#abcdef",
                    start_state_id: "{FOREIGN_STATE}", workflow_revision: 1
                ) {{ id }}
            }}"##
        ))
        .await;
    assert_eq!(response.errors.len(), 1);

    let row = issue_type::Entity::find_by_id(FIRST_TYPE)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.color, "#111111");
    assert_eq!(row.start_state_id.as_deref(), Some(FIRST_STATE));
    assert_eq!(row.workflow_revision, 1);
}

#[tokio::test]
async fn reorder_requires_exact_membership_and_returns_stable_requested_order() {
    let database = fixture().await;
    let rejected = schema(database.clone())
        .execute(format!(
            r#"mutation {{
                reorder_issue_types(project_id: "{PROJECT}", ordered_ids: ["{FIRST_TYPE}", "{FOREIGN_TYPE}"]) {{ id }}
            }}"#
        ))
        .await;
    assert_eq!(rejected.errors.len(), 1);

    let accepted = schema(database.clone())
        .execute(format!(
            r#"mutation {{
                reorder_issue_types(project_id: "{PROJECT}", ordered_ids: ["{SECOND_TYPE}", "{FIRST_TYPE}"]) {{ id sortOrder }}
            }}"#
        ))
        .await;
    assert!(accepted.errors.is_empty(), "{:?}", accepted.errors);
    let data = serde_json::to_value(accepted.data).unwrap();
    let rows = data["reorder_issue_types"].as_array().unwrap();
    assert_eq!(rows[0]["id"], "20000000-0000-0000-0000-000000000002");
    assert_eq!(rows[0]["sortOrder"], 0);
    assert_eq!(rows[1]["id"], "20000000-0000-0000-0000-000000000001");
    assert_eq!(rows[1]["sortOrder"], 1);
    assert_eq!(
        issue_type::Entity::find_by_id(FOREIGN_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .sort_order,
        7
    );
}

#[tokio::test]
async fn reorder_rolls_back_every_row_when_one_save_fails() {
    let database = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            CREATE TRIGGER fail_issue_type_reorder
            BEFORE UPDATE OF sort_order ON worktracker_issuetype
            WHEN NEW.id = '{FIRST_TYPE}' AND NEW.sort_order = 1
            BEGIN SELECT RAISE(ABORT, 'forced reorder failure'); END;
            "#
        ))
        .await
        .unwrap();
    let response = schema(database.clone())
        .execute(format!(
            r#"mutation {{
                reorder_issue_types(project_id: "{PROJECT}", ordered_ids: ["{SECOND_TYPE}", "{FIRST_TYPE}"]) {{ id }}
            }}"#
        ))
        .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        issue_type::Entity::find_by_id(FIRST_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .sort_order,
        0
    );
    assert_eq!(
        issue_type::Entity::find_by_id(SECOND_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .sort_order,
        1
    );
}
