use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, Statement};

use ticketry_work_management::commands::CommandDatabase;

async fn fixture() -> sea_orm::DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared(
            r#"
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
                agent_allowed BOOLEAN NOT NULL, handoff BOOLEAN NOT NULL DEFAULT 0
            );
            CREATE TABLE worktracker_launchbinding (
                id INTEGER PRIMARY KEY, issue_type_id TEXT NOT NULL,
                state_id TEXT NOT NULL, prompt TEXT NOT NULL,
                required_skills JSON NOT NULL, entry_skill TEXT,
                model_id TEXT, reasoning_id TEXT,
                auto_start BOOLEAN NOT NULL, subtree_run_enabled BOOLEAN NOT NULL,
                created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
            );
            "#,
        )
        .await
        .unwrap();
    database
}

async fn row_count(database: &sea_orm::DatabaseConnection, table: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap()
}

#[tokio::test]
async fn project_create_returns_the_aggregate_after_seeding_reviewed_defaults() {
    let database = fixture().await;
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database.clone())),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    let response = schema
        .execute(
            r#"mutation {
                create_project(name: "Ticketry", slug: "tic") {
                    id name slug description onboardingRequired
                }
            }"#,
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = serde_json::to_value(response.data).unwrap();
    assert!(data["create_project"]["id"].is_string());
    assert_eq!(data["create_project"]["name"], "Ticketry");
    assert_eq!(data["create_project"]["slug"], "TIC");
    assert_eq!(data["create_project"]["description"], "");
    assert_eq!(data["create_project"]["onboardingRequired"], false);

    for (table, expected) in [
        ("worktracker_project", 1),
        ("worktracker_state", 8),
        ("worktracker_issuetype", 4),
        ("worktracker_issuetypetransition", 23),
        ("worktracker_launchbinding", 15),
    ] {
        assert_eq!(
            row_count(&database, table).await,
            expected,
            "seeded {table}"
        );
    }
}
