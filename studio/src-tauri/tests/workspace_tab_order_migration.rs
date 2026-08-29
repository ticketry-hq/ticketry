use muxed_studio_lib::work_management::{
    module_presentation_migration, workflow_color_migration,
    workspace_tab_order_migration::{self, LEDGER_TABLE, MIGRATION_ID, SOURCE_COMMIT},
};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

async fn memory_database() -> sea_orm::DatabaseConnection {
    Database::connect("sqlite::memory:")
        .await
        .expect("open workspace-tab migration fixture")
}

async fn issue_columns(database: &sea_orm::DatabaseConnection) -> Vec<String> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_issue)".to_owned(),
        ))
        .await
        .expect("inspect Issue columns")
        .into_iter()
        .map(|row| row.try_get("", "name").expect("Issue column name"))
        .collect()
}

#[tokio::test]
async fn fresh_migration_defaults_existing_and_new_rows_and_reopens_idempotently() {
    let database = memory_database().await;
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             INSERT INTO worktracker_issue (id, name) VALUES ('task-a', 'Existing');",
        )
        .await
        .expect("seed pre-migration Issue table");

    workspace_tab_order_migration::install(&database)
        .await
        .expect("install workspace-tab migration");
    let first_columns = issue_columns(&database).await;
    workspace_tab_order_migration::install(&database)
        .await
        .expect("repeat workspace-tab migration");
    assert_eq!(issue_columns(&database).await, first_columns);
    assert!(first_columns
        .iter()
        .any(|column| column == "workspace_tab_order"));

    database
        .execute_unprepared("INSERT INTO worktracker_issue (id, name) VALUES ('task-b', 'New');")
        .await
        .expect("insert post-migration Issue");
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, workspace_tab_order FROM worktracker_issue ORDER BY id".to_owned(),
        ))
        .await
        .expect("read migrated Issue rows");
    assert_eq!(rows.len(), 2);
    for row in rows {
        assert_eq!(
            row.try_get::<serde_json::Value>("", "workspace_tab_order")
                .expect("workspace order"),
            serde_json::json!([])
        );
    }

    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT migration_id, source_commit FROM {LEDGER_TABLE} WHERE singleton = 1"),
        ))
        .await
        .expect("read migration ledger")
        .expect("migration ledger row");
    assert_eq!(
        ledger.try_get::<String>("", "migration_id").unwrap(),
        MIGRATION_ID
    );
    assert_eq!(
        ledger.try_get::<String>("", "source_commit").unwrap(),
        SOURCE_COMMIT
    );
}

#[tokio::test]
async fn adoption_preserves_valid_preexisting_workspace_order() {
    let database = memory_database().await;
    database
        .execute_unprepared(
            r#"CREATE TABLE worktracker_issue (
                   id TEXT PRIMARY KEY,
                   workspace_tab_order JSON NOT NULL DEFAULT '[]'
               );
               INSERT INTO worktracker_issue (id, workspace_tab_order)
               VALUES ('task-a', '[{"kind":"details"}]');"#,
        )
        .await
        .expect("seed adopted Issue schema");

    workspace_tab_order_migration::install(&database)
        .await
        .expect("adopt preexisting workspace order");
    workspace_tab_order_migration::install(&database)
        .await
        .expect("reopen adopted workspace order");
    let stored = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT workspace_tab_order FROM worktracker_issue WHERE id = 'task-a'".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<serde_json::Value>("", "workspace_tab_order")
        .unwrap();
    assert_eq!(stored, serde_json::json!([{"kind": "details"}]));
}

#[tokio::test]
async fn failed_ledger_creation_rolls_back_the_issue_column() {
    let database = memory_database().await;
    database
        .execute_unprepared(&format!(
            "CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY);
             CREATE VIEW {LEDGER_TABLE} AS SELECT 1 AS singleton;"
        ))
        .await
        .expect("seed deterministic ledger collision");

    workspace_tab_order_migration::install(&database)
        .await
        .expect_err("ledger collision must fail migration");

    assert!(!issue_columns(&database)
        .await
        .iter()
        .any(|column| column == "workspace_tab_order"));
}

#[test]
fn workspace_tab_checkpoint_is_between_colors_and_module_presentation() {
    let ledgers = muxed_studio_lib::installation::classification::rust_ledger::owned_ledgers();
    let colors = ledgers
        .iter()
        .position(|(table, _)| *table == workflow_color_migration::LEDGER_TABLE)
        .expect("workflow color ledger");
    let workspace = ledgers
        .iter()
        .position(|(table, _)| *table == LEDGER_TABLE)
        .expect("workspace-tab ledger");
    let presentation = ledgers
        .iter()
        .position(|(table, _)| *table == module_presentation_migration::LEDGER_TABLE)
        .expect("module presentation ledger");
    assert_eq!(workspace, colors + 1);
    assert_eq!(presentation, workspace + 1);
}
