//! Add the durable WorkItem workspace-tab order after workflow-color adoption.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260829-0049-workspace-tab-order-v1";
pub const LEDGER_TABLE: &str = "ticketry_workspace_tab_order_migration";
pub const SOURCE_COMMIT: &str = "602596a1ea0146a1d19aad20912bdd9d3b2f1dfe";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        verify_issue_column(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, "worktracker_issue").await? {
        if !column_exists(&transaction).await? {
            transaction
                .execute_unprepared(
                    "ALTER TABLE worktracker_issue ADD COLUMN workspace_tab_order JSON NOT NULL DEFAULT '[]' CHECK (json_valid(workspace_tab_order) AND json_type(workspace_tab_order) = 'array')",
                )
                .await?;
        }
        verify_issue_column(&transaction).await?;
    }

    transaction
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = {VERSION}), migration_id TEXT NOT NULL, source_commit TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ))
        .await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO {LEDGER_TABLE} (singleton, version, migration_id, source_commit) VALUES (1, ?, ?, ?)"
            ),
            [VERSION.into(), MIGRATION_ID.into(), SOURCE_COMMIT.into()],
        ))
        .await?;
    transaction.commit().await?;
    Ok(())
}

async fn verify_issue_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !table_exists(database, "worktracker_issue").await? {
        return Ok(());
    }
    if !column_exists(database).await? {
        return Err(DbErr::Custom(
            "workspace-tab-order migration ledger exists without its Issue column".to_owned(),
        ));
    }
    let invalid = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_issue WHERE workspace_tab_order IS NULL OR CASE WHEN json_valid(workspace_tab_order) THEN json_type(workspace_tab_order) <> 'array' ELSE 1 END"
                .to_owned(),
        ))
        .await?
        .expect("count query returns one row")
        .try_get::<i64>("", "count")?;
    if invalid != 0 {
        return Err(DbErr::Custom(format!(
            "workspace_tab_order contains {invalid} non-array value(s)"
        )));
    }
    Ok(())
}

async fn column_exists(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_issue)".to_owned(),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == "workspace_tab_order")
        }))
}

async fn table_exists(database: &impl ConnectionTrait, table: &str) -> Result<bool, DbErr> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await?
        .expect("count query returns one row");
    Ok(row.try_get::<i64>("", "count")? == 1)
}

async fn verify_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, migration_id, source_commit FROM {LEDGER_TABLE} WHERE singleton = 1"
            ),
        ))
        .await?
        .ok_or_else(|| DbErr::Custom("workspace-tab-order migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported workspace-tab-order migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}
