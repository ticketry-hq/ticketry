//! Add the configuration-only handoff flag to workflow transition edges.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260901-0053-workflow-transition-handoff-v1";
pub const LEDGER_TABLE: &str = "ticketry_workflow_handoff_migration";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_column(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }
    if table_exists(&transaction, "worktracker_issuetypetransition").await?
        && !column_exists(&transaction).await?
    {
        transaction.execute_unprepared(
            "ALTER TABLE worktracker_issuetypetransition ADD COLUMN handoff bool NOT NULL DEFAULT 0",
        ).await?;
    }
    verify_column(&transaction).await?;
    transaction.execute_unprepared(&format!(
        "CREATE TABLE {LEDGER_TABLE} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = {VERSION}), migration_id TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )).await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO {LEDGER_TABLE} (singleton, version, migration_id) VALUES (1, ?, ?)"
            ),
            [VERSION.into(), MIGRATION_ID.into()],
        ))
        .await?;
    transaction.commit().await?;
    Ok(())
}

async fn verify_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if table_exists(database, "worktracker_issuetypetransition").await?
        && !column_exists(database).await?
    {
        return Err(DbErr::Custom(
            "workflow-handoff migration ledger exists without its transition column".to_owned(),
        ));
    }
    Ok(())
}

async fn column_exists(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_issuetypetransition)".to_owned(),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == "handoff")
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

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    use super::install;

    #[tokio::test]
    async fn existing_edges_default_off_and_install_is_repeatable() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                "CREATE TABLE worktracker_issuetypetransition (
                id INTEGER PRIMARY KEY, agent_allowed bool NOT NULL
            );
            INSERT INTO worktracker_issuetypetransition VALUES (1, 1);",
            )
            .await
            .unwrap();

        install(&database).await.unwrap();
        install(&database).await.unwrap();

        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT agent_allowed, handoff FROM worktracker_issuetypetransition WHERE id=1"
                    .to_owned(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert!(row.try_get::<bool>("", "agent_allowed").unwrap());
        assert!(!row.try_get::<bool>("", "handoff").unwrap());
    }
}
