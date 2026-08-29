//! Move module ordering state out of Project and into one row per active module.
//!
//! Every statement runs on the caller's connection and inside one transaction.
//! The ledger makes later startups verification-only, while a failure rolls
//! back the table, copied rows, Project column removal, and ledger together.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260829-0050-module-presentation-v1";
pub const LEDGER_TABLE: &str = "ticketry_module_presentation_migration";
pub const PRESENTATION_TABLE: &str = "worktracker_modulepresentation";
pub const SOURCE_COMMIT: &str = "9d752d77b3da9766c3e4c79e32624cc66d860ddb";

const PROJECT_TABLE: &str = "worktracker_project";
const ISSUE_TABLE: &str = "worktracker_issue";
const MANUAL_ORDER_COLUMN: &str = "manual_module_order";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        verify_shape(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    create_presentation_table(&transaction).await?;
    copy_manual_module_order(&transaction).await?;
    remove_project_flag(&transaction).await?;
    write_ledger(&transaction).await?;
    verify_shape(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

async fn create_presentation_table(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    database
        .execute_unprepared(&format!(
            "CREATE TABLE {PRESENTATION_TABLE} (\
                module_id varchar(32) NOT NULL PRIMARY KEY \
                    REFERENCES {ISSUE_TABLE}(id) ON DELETE CASCADE \
                    DEFERRABLE INITIALLY DEFERRED, \
                rank varchar(64) NOT NULL DEFAULT '', \
                tab_hidden bool NOT NULL DEFAULT 0\
            ); \
            CREATE INDEX worktracker_modulepresentation_rank_idx \
                ON {PRESENTATION_TABLE}(rank)"
        ))
        .await?;
    Ok(())
}

async fn copy_manual_module_order(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !table_exists(database, PROJECT_TABLE).await?
        || !table_exists(database, ISSUE_TABLE).await?
        || !column_exists(database, PROJECT_TABLE, MANUAL_ORDER_COLUMN).await?
    {
        return Ok(());
    }
    database
        .execute_unprepared(&format!(
            "INSERT INTO {PRESENTATION_TABLE} (module_id, rank, tab_hidden) \
             SELECT module.id, module.rank, 0 \
             FROM {ISSUE_TABLE} AS module \
             JOIN {PROJECT_TABLE} AS project ON project.id = module.project_id \
             WHERE project.{MANUAL_ORDER_COLUMN} = 1 \
               AND module.type = 'module' \
               AND module.is_archived = 0"
        ))
        .await?;
    Ok(())
}

async fn remove_project_flag(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if table_exists(database, PROJECT_TABLE).await?
        && column_exists(database, PROJECT_TABLE, MANUAL_ORDER_COLUMN).await?
    {
        database
            .execute_unprepared(&format!(
                "ALTER TABLE {PROJECT_TABLE} DROP COLUMN {MANUAL_ORDER_COLUMN}"
            ))
            .await?;
    }
    Ok(())
}

async fn write_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    database
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (\
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
                "INSERT INTO {LEDGER_TABLE} \
                 (singleton, version, migration_id, source_commit) VALUES (1, ?, ?, ?)"
            ),
            [VERSION.into(), MIGRATION_ID.into(), SOURCE_COMMIT.into()],
        ))
        .await?;
    Ok(())
}

async fn verify_shape(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !table_exists(database, PRESENTATION_TABLE).await? {
        return Err(DbErr::Custom(
            "module-presentation migration ledger exists without its table".to_owned(),
        ));
    }
    for column in ["module_id", "rank", "tab_hidden"] {
        if !column_exists(database, PRESENTATION_TABLE, column).await? {
            return Err(DbErr::Custom(format!(
                "module-presentation table is missing {column}"
            )));
        }
    }
    if table_exists(database, PROJECT_TABLE).await?
        && column_exists(database, PROJECT_TABLE, MANUAL_ORDER_COLUMN).await?
    {
        return Err(DbErr::Custom(
            "module-presentation migration left Project.manual_module_order live".to_owned(),
        ));
    }
    Ok(())
}

async fn verify_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, migration_id, source_commit \
                 FROM {LEDGER_TABLE} WHERE singleton = 1"
            ),
        ))
        .await?
        .ok_or_else(|| DbErr::Custom("module-presentation migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported module-presentation migration {migration_id} at version {version}"
        )));
    }
    Ok(())
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

async fn column_exists(
    database: &impl ConnectionTrait,
    table: &str,
    column: &str,
) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == column)
        }))
}

#[cfg(test)]
#[path = "module_presentation_migration_tests.rs"]
mod tests;
