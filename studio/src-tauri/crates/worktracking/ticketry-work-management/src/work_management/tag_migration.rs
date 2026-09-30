//! Restore project-scoped Work Item tags removed by the legacy 0035 migration.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "0060_work_item_tags";
pub const LEDGER_TABLE: &str = "ticketry_work_item_tags_migration";

const LABEL_TABLE: &str = "worktracker_label";
const ISSUE_LABEL_TABLE: &str = "worktracker_issue_labels";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        if !table_exists(&transaction, LABEL_TABLE).await?
            || !table_exists(&transaction, ISSUE_LABEL_TABLE).await?
        {
            return Err(DbErr::Custom(
                "tag migration ledger exists but a tag table is absent".to_owned(),
            ));
        }
        transaction.commit().await?;
        return Ok(());
    }

    transaction
        .execute_unprepared(
            "CREATE TABLE IF NOT EXISTS worktracker_label (
                id char(32) NOT NULL PRIMARY KEY,
                project_id char(32) NOT NULL
                    REFERENCES worktracker_project(id) ON DELETE CASCADE,
                name varchar(255) NOT NULL,
                color varchar(32) NOT NULL DEFAULT ''
             );
             CREATE UNIQUE INDEX IF NOT EXISTS worktracker_label_project_name_uniq
                ON worktracker_label(project_id, name);
             CREATE INDEX IF NOT EXISTS worktracker_label_project_id_idx
                ON worktracker_label(project_id);
             CREATE TABLE IF NOT EXISTS worktracker_issue_labels (
                id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                issue_id char(32) NOT NULL
                    REFERENCES worktracker_issue(id) ON DELETE CASCADE,
                label_id char(32) NOT NULL
                    REFERENCES worktracker_label(id) ON DELETE CASCADE
             );
             CREATE UNIQUE INDEX IF NOT EXISTS worktracker_issue_labels_issue_label_uniq
                ON worktracker_issue_labels(issue_id, label_id);
             CREATE INDEX IF NOT EXISTS worktracker_issue_labels_issue_id_idx
                ON worktracker_issue_labels(issue_id);
             CREATE INDEX IF NOT EXISTS worktracker_issue_labels_label_id_idx
                ON worktracker_issue_labels(label_id);",
        )
        .await?;
    transaction
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                version INTEGER NOT NULL CHECK (version = {VERSION}),
                migration_id TEXT NOT NULL
             );
             INSERT INTO {LEDGER_TABLE} VALUES (1, {VERSION}, '{MIGRATION_ID}')"
        ))
        .await?;
    transaction.commit().await
}

async fn table_exists(database: &impl ConnectionTrait, table: &str) -> Result<bool, DbErr> {
    Ok(database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await?
        .is_some())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    #[tokio::test]
    async fn install_creates_tag_tables_and_is_idempotent() {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE worktracker_project (id TEXT PRIMARY KEY);
                 CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY);",
            )
            .await
            .unwrap();

        super::install(&database).await.unwrap();
        super::install(&database).await.unwrap();

        for table in [
            "worktracker_label",
            "worktracker_issue_labels",
            super::LEDGER_TABLE,
        ] {
            assert!(database
                .query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    [table.into()],
                ))
                .await
                .unwrap()
                .is_some());
        }
    }
}
