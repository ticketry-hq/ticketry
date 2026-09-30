//! Add the one durable GitHub pull-request mapping to each Worktree row.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260831-0052-worktree-pull-request-url-v1";
pub const LEDGER_TABLE: &str = "ticketry_worktree_pull_request_url_migration";
pub const SOURCE_COMMIT: &str = "7453d4e956dfe394d73924e26b51e0c8580af90a";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        verify_column(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, "worktrees").await? {
        if !column_exists(&transaction).await? {
            transaction
                .execute_unprepared(
                    "ALTER TABLE worktrees ADD COLUMN pull_request_url VARCHAR NULL",
                )
                .await?;
        }
        verify_column(&transaction).await?;
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

pub async fn installed(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    table_exists(database, LEDGER_TABLE).await
}

pub async fn verify(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    verify_ledger(database).await?;
    verify_column(database).await
}

async fn verify_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if table_exists(database, "worktrees").await? && !column_exists(database).await? {
        return Err(DbErr::Custom(
            "worktree pull-request migration ledger exists without its URL column".to_owned(),
        ));
    }
    Ok(())
}

async fn column_exists(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktrees)".to_owned(),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == "pull_request_url")
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
        .ok_or_else(|| DbErr::Custom("worktree pull-request migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported worktree pull-request migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}
