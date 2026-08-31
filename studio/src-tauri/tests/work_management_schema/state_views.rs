use sea_orm::{
    ColumnTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder,
};

use ticketry_entities::{runs::status_event, work_management::state};
use ticketry_runs::persistence::RunsServices;
use ticketry_work_management::work_management::commands::{
    status_facts::WorkFactRecorder, CommandDatabase,
};

const PROJECT: &str = "10000000000000000000000000000000";
const FOREIGN_PROJECT: &str = "10000000000000000000000000000009";
const BACKLOG: &str = "20000000000000000000000000000001";
const STARTED: &str = "20000000000000000000000000000002";
const DONE: &str = "20000000000000000000000000000003";
const FOREIGN_STATE: &str = "20000000000000000000000000000009";

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
            CREATE TABLE worktracker_issue (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
                issue_type_id TEXT NOT NULL, parent_id TEXT, module_id TEXT, state_id TEXT,
                state_revision INTEGER NOT NULL, name TEXT NOT NULL, sequence_id INTEGER NOT NULL,
                is_archived BOOLEAN NOT NULL, rank TEXT NOT NULL, description TEXT NOT NULL,
                workspace_tab_order TEXT NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                level TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
                start_state_id TEXT, workflow_revision INTEGER NOT NULL,
                is_pathfind BOOLEAN NOT NULL, created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
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
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Project', 'PRJ', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
                ('{FOREIGN_PROJECT}', 'Foreign', 'FOR', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '#111111', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{STARTED}', '{PROJECT}', 'Started', 'started', '#222222', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{DONE}', '{PROJECT}', 'Done', 'completed', '#333333', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{FOREIGN_STATE}', '{FOREIGN_PROJECT}', 'Foreign', 'started', '#999999', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        ))
        .await
        .unwrap();
    database
}

fn schema(database: DatabaseConnection) -> seaography::async_graphql::dynamic::Schema {
    let recorder = WorkFactRecorder::new(
        RunsServices::new(database.clone())
            .outbox()
            .events()
            .clone(),
    );
    ticketry_graphql_schema::query_root::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database)),
        None,
        None,
        None,
        Some(recorder),
        None,
        None,
    )
    .unwrap()
}

#[tokio::test]
async fn keeps_all_four_state_contracts_unchanged() {
    let sdl = ticketry_graphql_schema::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build generated contract");
    for field in [
        "create_state(project_id: String!, name: String!, group: String!, color: String): WorktrackerState!",
        "update_state(id: String!, name: String, group: String, color: String, sort_order: Int): WorktrackerState!",
        "delete_state(state_id: String!): Boolean!",
        "reorder_states(project_id: String!, ordered_ids: [String!]!): [WorktrackerState!]!",
    ] {
        assert!(sdl.contains(field), "missing {field}");
    }
}

#[tokio::test]
async fn views_preserve_colors_ordering_guards_cleanup_and_status_facts() {
    let database = fixture().await;
    let schema = schema(database.clone());

    let created = schema
        .execute(format!(
            r#"mutation {{
                create_state(project_id: "{PROJECT}", name: "Review", group: "started") {{
                    id name group color sortOrder isProtected
                }}
            }}"#
        ))
        .await;
    assert!(created.errors.is_empty(), "{:?}", created.errors);
    let created = serde_json::to_value(created.data).unwrap();
    let created = &created["create_state"];
    let created_id = created["id"].as_str().unwrap().to_owned();
    assert_eq!(created["sortOrder"], 3);
    assert_eq!(created["isProtected"], false);
    assert!(!created["color"].as_str().unwrap().is_empty());

    let updated = schema
        .execute(format!(
            r##"mutation {{
                update_state(id: "{created_id}", name: "In review", color: "#abcdef") {{
                    id name color sortOrder
                }}
            }}"##
        ))
        .await;
    assert!(updated.errors.is_empty(), "{:?}", updated.errors);

    let reordered = schema
        .execute(format!(
            r#"mutation {{
                reorder_states(project_id: "{PROJECT}", ordered_ids: [
                    "{created_id}", "{DONE}", "{STARTED}", "{BACKLOG}"
                ]) {{ id sortOrder }}
            }}"#
        ))
        .await;
    assert!(reordered.errors.is_empty(), "{:?}", reordered.errors);
    let reordered = serde_json::to_value(reordered.data).unwrap();
    assert_eq!(reordered["reorder_states"][0]["id"], created_id);
    assert_eq!(reordered["reorder_states"][0]["sortOrder"], 0);

    let protected = schema
        .execute(format!(
            r#"mutation {{ delete_state(state_id: "{BACKLOG}") }}"#
        ))
        .await;
    assert_eq!(protected.errors.len(), 1);
    assert!(protected.errors[0].message.contains("protected"));

    let deleted = schema
        .execute(format!(
            r#"mutation {{ delete_state(state_id: "{created_id}") }}"#
        ))
        .await;
    assert!(deleted.errors.is_empty(), "{:?}", deleted.errors);
    assert!(state::Entity::find_by_id(created_id.replace('-', ""))
        .one(&database)
        .await
        .unwrap()
        .is_none());

    let facts = status_event::Entity::find()
        .order_by_asc(status_event::Column::Cursor)
        .all(&database)
        .await
        .unwrap();
    assert_eq!(facts.len(), 7);
    assert_eq!(facts[0].event_kind, "workflow_state.changed");
    assert_eq!(facts[1].event_kind, "workflow_state.changed");
    assert!(facts[2..6]
        .iter()
        .all(|fact| fact.event_kind == "workflow_state.changed"));
    assert_eq!(facts[6].event_kind, "workflow_state.deleted");
}

#[tokio::test]
async fn a_failed_reorder_rolls_back_every_state_and_status_fact() {
    let database = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            CREATE TRIGGER fail_state_reorder
            BEFORE UPDATE OF sort_order ON worktracker_state
            WHEN NEW.id = '{BACKLOG}' AND NEW.sort_order = 2
            BEGIN SELECT RAISE(ABORT, 'forced reorder failure'); END;
            "#
        ))
        .await
        .unwrap();
    let response = schema(database.clone())
        .execute(format!(
            r#"mutation {{
                reorder_states(project_id: "{PROJECT}", ordered_ids: [
                    "{DONE}", "{STARTED}", "{BACKLOG}"
                ]) {{ id sortOrder }}
            }}"#
        ))
        .await;
    assert_eq!(response.errors.len(), 1);

    let rows = state::Entity::find()
        .filter(state::Column::ProjectId.eq(PROJECT))
        .order_by_asc(state::Column::SortOrder)
        .all(&database)
        .await
        .unwrap();
    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        [BACKLOG, STARTED, DONE]
    );
    assert!(status_event::Entity::find()
        .all(&database)
        .await
        .unwrap()
        .is_empty());
}
