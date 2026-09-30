//! Add nullable LaunchBinding.profile for workflow-scoped Codex selection.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, TransactionTrait};

pub const MIGRATION_ID: &str = "0056_launch_binding_profile";
pub const LEDGER_TABLE: &str = "ticketry_launch_binding_profile_migration";
pub const VERSION: i32 = 1;

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    let applied = transaction
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!("SELECT 1 FROM sqlite_master WHERE type='table' AND name='{LEDGER_TABLE}'"),
        ))
        .await?
        .is_some();
    if !applied {
        for table in ["worktracker_launchbinding", "terminal_launch_material"] {
            let columns = transaction
                .query_all_raw(sea_orm::Statement::from_string(
                    sea_orm::DbBackend::Sqlite,
                    format!("PRAGMA table_info('{table}')"),
                ))
                .await?;
            if columns.is_empty() {
                continue;
            }
            if !columns
                .iter()
                .any(|row| row.try_get::<String>("", "name").as_deref() == Ok("profile"))
            {
                transaction
                    .execute_unprepared(&format!(
                        "ALTER TABLE {table} ADD COLUMN profile varchar(255) NULL"
                    ))
                    .await?;
            }
        }
        transaction
            .execute_unprepared(&format!(
                "CREATE TABLE {LEDGER_TABLE} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = {VERSION}), migration_id TEXT NOT NULL); \
                 INSERT INTO {LEDGER_TABLE} VALUES (1, {VERSION}, '{MIGRATION_ID}')"
            ))
            .await?;
    }
    transaction.commit().await
}
