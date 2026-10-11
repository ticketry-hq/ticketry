//! Persist each project's chronological sprint sequence without rebuilding its table.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

use super::commands::fractional_rank;

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "0065_sprint_rank";
pub const LEDGER_TABLE: &str = "ticketry_sprint_rank_migration";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    let applied = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            [LEDGER_TABLE.into()],
        ))
        .await?
        .is_some();
    if applied {
        let row = transaction
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT version,migration_id FROM {LEDGER_TABLE} WHERE singleton=1"),
            ))
            .await?
            .ok_or_else(|| DbErr::Custom("sprint-rank migration ledger is empty".into()))?;
        if row.try_get::<i32>("", "version")? != VERSION
            || row.try_get::<String>("", "migration_id")? != MIGRATION_ID
        {
            return Err(DbErr::Custom(
                "unsupported sprint-rank migration ledger".into(),
            ));
        }
    } else {
        transaction
            .execute_unprepared("ALTER TABLE worktracker_sprint ADD COLUMN rank varchar(64) NULL")
            .await?;
        backfill(&transaction).await?;
        // SQLite 3.51 cannot SET NOT NULL. Replace only this column after backfill;
        // unlike a table rebuild, this preserves every inbound FK and related row.
        transaction.execute_unprepared(
            "ALTER TABLE worktracker_sprint ADD COLUMN rank_required varchar(64) NOT NULL DEFAULT '';
             UPDATE worktracker_sprint SET rank_required=rank;
             ALTER TABLE worktracker_sprint DROP COLUMN rank;
             ALTER TABLE worktracker_sprint RENAME COLUMN rank_required TO rank;
             CREATE INDEX worktracker_sprint_project_rank_idx ON worktracker_sprint(project_id,rank,id);"
        ).await?;
        transaction
            .execute_unprepared(&format!(
                "CREATE TABLE {LEDGER_TABLE} (
                singleton INTEGER PRIMARY KEY CHECK (singleton=1),
                version INTEGER NOT NULL CHECK (version={VERSION}),
                migration_id TEXT NOT NULL
             ); INSERT INTO {LEDGER_TABLE} VALUES (1,{VERSION},'{MIGRATION_ID}')"
            ))
            .await?;
    }
    verify_rank_column(&transaction).await?;
    transaction.commit().await
}

async fn backfill(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id,project_id FROM worktracker_sprint
         ORDER BY project_id,CASE status WHEN 'completed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
                  created_at,id"
                .to_owned(),
        ))
        .await?;
    let mut projects = std::collections::BTreeMap::<String, Vec<String>>::new();
    for row in rows {
        projects
            .entry(row.try_get("", "project_id")?)
            .or_default()
            .push(row.try_get("", "id")?);
    }
    for ids in projects.values() {
        for (id, rank) in ids.iter().zip(fractional_rank::rebalance(ids.len())) {
            database
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "UPDATE worktracker_sprint SET rank=? WHERE id=?",
                    [rank.into(), id.clone().into()],
                ))
                .await?;
        }
    }
    Ok(())
}

async fn verify_rank_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_sprint)".to_owned(),
        ))
        .await?;
    if rows.iter().any(|row| {
        row.try_get::<String>("", "name")
            .is_ok_and(|name| name == "rank")
            && row
                .try_get::<i32>("", "notnull")
                .is_ok_and(|notnull| notnull == 1)
    }) {
        Ok(())
    } else {
        Err(DbErr::Custom(
            "sprint-rank migration requires a non-null rank column".into(),
        ))
    }
}
