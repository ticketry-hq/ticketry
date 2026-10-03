//! Sprint planning tables and nullable backlog membership.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "0063_sprints";
pub const LEDGER_TABLE: &str = "ticketry_sprint_migration";

const SPRINT_TABLES: &[&str] = &[
    "worktracker_sprint",
    "worktracker_sprint_goal",
    "worktracker_sprint_suggestion",
];

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        for table in SPRINT_TABLES {
            if !table_exists(&transaction, table).await? {
                return Err(DbErr::Custom(format!(
                    "sprint migration ledger exists but {table} is absent"
                )));
            }
        }
        if !issue_column_exists(&transaction).await? {
            return Err(DbErr::Custom(
                "sprint migration ledger exists but the sprint schema is absent".to_owned(),
            ));
        }
        transaction.commit().await?;
        return Ok(());
    }

    transaction
        .execute_unprepared(
            "CREATE TABLE IF NOT EXISTS worktracker_sprint (
                id char(32) NOT NULL PRIMARY KEY,
                name varchar(255) NOT NULL,
                status varchar(10) NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'active', 'completed')),
                suggestion_run_id char(32) NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
                goals_revised_at datetime NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL,
                project_id char(32) NOT NULL
                    REFERENCES worktracker_project(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS worktracker_sprint_project_id_idx
                ON worktracker_sprint(project_id);
             CREATE UNIQUE INDEX IF NOT EXISTS worktracker_sprint_one_active_per_project
                ON worktracker_sprint(project_id) WHERE status = 'active';
             CREATE TABLE IF NOT EXISTS worktracker_sprint_goal (
                id char(32) NOT NULL PRIMARY KEY,
                sprint_id char(32) NOT NULL REFERENCES worktracker_sprint(id) ON DELETE CASCADE,
                position integer NOT NULL,
                text text NOT NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL
             );
             CREATE UNIQUE INDEX IF NOT EXISTS worktracker_sprint_goal_position_idx
                ON worktracker_sprint_goal(sprint_id, position);
             CREATE TABLE IF NOT EXISTS worktracker_sprint_suggestion (
                id char(32) NOT NULL PRIMARY KEY,
                sprint_id char(32) NOT NULL REFERENCES worktracker_sprint(id) ON DELETE CASCADE,
                goal_id char(32) NOT NULL REFERENCES worktracker_sprint_goal(id) ON DELETE CASCADE,
                issue_id char(32) NULL REFERENCES worktracker_issue(id) ON DELETE CASCADE,
                proposed_name varchar(255) NULL,
                proposed_epic_id char(32) NULL REFERENCES worktracker_issue(id) ON DELETE SET NULL,
                reason text NOT NULL,
                status varchar(10) NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'accepted', 'dismissed')),
                run_id char(32) NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
                created_at datetime NOT NULL,
                CHECK (status != 'waiting' OR ((issue_id IS NULL) != (proposed_name IS NULL)))
             );
             CREATE INDEX IF NOT EXISTS worktracker_sprint_suggestion_status_idx
                ON worktracker_sprint_suggestion(sprint_id, status);",
        )
        .await?;
    if !issue_column_exists(&transaction).await? {
        transaction
            .execute_unprepared(
                "ALTER TABLE worktracker_issue ADD COLUMN sprint_id char(32) NULL
                    REFERENCES worktracker_sprint(id) ON DELETE SET NULL",
            )
            .await?;
    }
    transaction
        .execute_unprepared(
            "CREATE INDEX IF NOT EXISTS worktracker_issue_sprint_id_idx
                ON worktracker_issue(sprint_id);",
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

async fn issue_column_exists(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_issue)".to_owned(),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == "sprint_id")
        }))
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
