//! Conditional adoption of the former reviewed workflow-state colors.
//!
//! Source commit `3a5f434a90696f40a4911e401a84db009cdfa4e7` changed these defaults.
//! An existing row changes only when its state name and stored color both match
//! the former reviewed value. The target values come from the reviewed catalog.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

use super::commands::reviewed_defaults;

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260827-1150-reviewed-workflow-state-colors-v1";
pub const LEDGER_TABLE: &str = "ticketry_workflow_color_migration";
pub const SOURCE_COMMIT: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";

struct FormerReviewedColor {
    state_name: &'static str,
    color: &'static str,
}

const FORMER_REVIEWED_COLORS: &[FormerReviewedColor] = &[
    FormerReviewedColor {
        state_name: "Ideas",
        color: "#D12771",
    },
    FormerReviewedColor {
        state_name: "Grill",
        color: "#60646C",
    },
    FormerReviewedColor {
        state_name: "Review",
        color: "#D6409F",
    },
];

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, "worktracker_state").await? {
        for former in FORMER_REVIEWED_COLORS {
            let target = reviewed_defaults::state_color(former.state_name)
                .map_err(|error| {
                    DbErr::Custom(format!("could not read reviewed defaults: {error}"))
                })?
                .ok_or_else(|| {
                    DbErr::Custom(format!(
                        "reviewed defaults are missing the {} state",
                        former.state_name
                    ))
                })?;
            transaction
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "UPDATE worktracker_state SET color = ? WHERE name = ? AND color = ?",
                    [target.into(), former.state_name.into(), former.color.into()],
                ))
                .await?;
        }
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
        .ok_or_else(|| DbErr::Custom("workflow-color migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported workflow-color migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}
