use sea_orm::{ConnectionTrait, DbBackend, DbErr, Statement};

use super::VERSION;

pub(super) async fn exists(database: &impl ConnectionTrait, table: &str) -> Result<bool, DbErr> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await?
        .ok_or_else(|| DbErr::Custom("catalog migration table check returned no row".to_owned()))?;
    Ok(row.try_get::<i64>("", "count")? == 1)
}

pub(super) async fn all_tables_exist(
    database: &impl ConnectionTrait,
    tables: &[&str],
) -> Result<bool, DbErr> {
    for table in tables {
        if !exists(database, table).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn write(
    database: &impl ConnectionTrait,
    table: &str,
    migration_id: &str,
    source_commit: &str,
) -> Result<(), DbErr> {
    database
        .execute_unprepared(&format!(
            "CREATE TABLE {table} (\
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1), \
                version INTEGER NOT NULL CHECK (version = {VERSION}), \
                migration_id TEXT NOT NULL, \
                source_commit TEXT NOT NULL, \
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\
            )"
        ))
        .await?;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO {table} \
                 (singleton, version, migration_id, source_commit) VALUES (1, ?, ?, ?)"
            ),
            [VERSION.into(), migration_id.into(), source_commit.into()],
        ))
        .await?;
    Ok(())
}

pub(super) async fn verify(
    database: &impl ConnectionTrait,
    table: &str,
    expected_id: &str,
    expected_source: &str,
) -> Result<(), DbErr> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT version, migration_id, source_commit FROM {table} WHERE singleton = 1"),
        ))
        .await?
        .ok_or_else(|| DbErr::Custom(format!("{expected_id} migration ledger is empty")))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != expected_id || source_commit != expected_source {
        return Err(DbErr::Custom(format!(
            "unsupported catalog migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}
