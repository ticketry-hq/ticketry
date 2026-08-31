use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, Statement};
use seaography::async_graphql::Value;

use ticketry_work_management::work_management::commands::CommandDatabase;

const PROJECT: &str = "10000000000000000000000000000000";

async fn fixture() -> sea_orm::DatabaseConnection {
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
            CREATE TABLE worktracker_issuetype (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES worktracker_project(id) ON DELETE CASCADE
            );
            CREATE TABLE worktracker_issue (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                issue_type_id TEXT NOT NULL
                    REFERENCES worktracker_issuetype(id) ON DELETE RESTRICT
            );
            CREATE TABLE worktracker_issuetypetransition (
                id INTEGER PRIMARY KEY,
                issue_type_id TEXT NOT NULL
                    REFERENCES worktracker_issuetype(id) ON DELETE CASCADE
            );
            INSERT INTO worktracker_project VALUES (
                '{PROJECT}', 'Project', 'PRJ', '', 0, 0,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
            );
            INSERT INTO worktracker_issuetype VALUES ('type', '{PROJECT}');
            INSERT INTO worktracker_issue VALUES ('issue', '{PROJECT}', 'type');
            INSERT INTO worktracker_issuetypetransition VALUES (1, 'type');
            CREATE TRIGGER fail_project_delete BEFORE DELETE ON worktracker_project
                BEGIN SELECT RAISE(ABORT, 'injected project delete failure'); END;
            "#,
        ))
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

fn schema(database: sea_orm::DatabaseConnection) -> seaography::async_graphql::dynamic::Schema {
    muxed_studio_lib::query_root::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database)),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
}

#[tokio::test]
async fn ordered_project_delete_rolls_back_and_cleans_references_atomically() {
    let database = fixture().await;
    let schema = schema(database.clone());
    let mutation = format!(r#"mutation {{ delete_project(id: "{PROJECT}") }}"#);

    let failed = schema.execute(&mutation).await;
    assert_eq!(failed.errors.len(), 1);
    assert_eq!(
        failed.errors[0]
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("code")),
        Some(&Value::from("worktracker_storage_failed"))
    );
    for table in [
        "worktracker_project",
        "worktracker_issue",
        "worktracker_issuetype",
        "worktracker_issuetypetransition",
    ] {
        assert_eq!(row_count(&database, table).await, 1, "rolled back {table}");
    }

    database
        .execute_unprepared("DROP TRIGGER fail_project_delete")
        .await
        .unwrap();
    let deleted = schema.execute(&mutation).await;
    assert!(deleted.errors.is_empty(), "{:?}", deleted.errors);
    assert_eq!(
        serde_json::to_value(deleted.data).unwrap()["delete_project"],
        true
    );
    for table in [
        "worktracker_project",
        "worktracker_issue",
        "worktracker_issuetype",
        "worktracker_issuetypetransition",
    ] {
        assert_eq!(row_count(&database, table).await, 0, "cleaned {table}");
    }
}
