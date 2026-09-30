//! Migration-first creation of the ticketry_shiprecords receipt table.
//!
//! Every statement runs on the caller's connection inside one transaction and
//! the ledger makes later runs verification-only. The database constraints
//! carry the append-only receipt invariants, so no writer can weaken them:
//! module ownership is mandatory and cascades deletion; the task reference is
//! optional, checked, and nulled by task deletion; one row per caller-supplied
//! operation id; complete pull-request facts or none; only open, merged, and
//! closed are valid PR states; PR state moves only from open to merged or
//! closed; PR refresh requires a recorded receipt; and full lowercase commit
//! SHAs, at least one.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260915-0054-ship-record-v1";
pub const LEDGER_TABLE: &str = "ticketry_ship_record_migration";
pub const SOURCE_COMMIT: &str = "23d143fab160d13f739d93652a20553deb05f5f3";
pub const SHIP_RECORD_TABLE: &str = "ticketry_shiprecords";
pub const SHIP_RECORD_COLUMNS: &[&str] = &[
    "id",
    "module_id",
    "task_id",
    "checkout_kind",
    "checkout_label",
    "operation_id",
    "branch",
    "commit_shas",
    "steps",
    "acted_at",
    "pr_url",
    "pr_number",
    "pr_state",
    "pr_target_branch",
    "pr_head_commit",
    "pr_refreshed_at",
];

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        verify_shape(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    transaction.execute_unprepared(SHIP_RECORD_SCHEMA).await?;
    write_ledger(&transaction).await?;
    verify_shape(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

/// Whether the ship-record ledger has been installed in this database.
pub async fn installed(database: &impl ConnectionTrait) -> bool {
    table_exists(database, LEDGER_TABLE).await.unwrap_or(false)
}

const SHIP_RECORD_SCHEMA: &str = r#"
CREATE TABLE ticketry_shiprecords (
    id varchar(32) NOT NULL PRIMARY KEY,
    module_id varchar(32) NOT NULL
        REFERENCES worktracker_issue(id) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    task_id varchar(32) NULL
        REFERENCES worktracker_issue(id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    checkout_kind varchar(16) NOT NULL
        CHECK (checkout_kind IN ('task_worktree', 'module_checkout')),
    checkout_label varchar(255) NOT NULL
        CHECK (LENGTH(checkout_label) > 0),
    operation_id varchar(255) NOT NULL
        CHECK (LENGTH(operation_id) > 0),
    branch varchar(255) NOT NULL
        CHECK (LENGTH(branch) > 0),
   commit_shas json NOT NULL
        CHECK (json_type(commit_shas) = 'array' AND json_array_length(commit_shas) > 0),
    steps json NOT NULL
        CHECK (json_type(steps) = 'array'),
    acted_at varchar(64) NOT NULL
        CHECK (LENGTH(acted_at) > 0),
    pr_url varchar(1024) NULL,
    pr_number integer NULL,
    pr_state varchar(16) NULL
        CHECK (pr_state IS NULL OR pr_state IN ('open', 'merged', 'closed')),
    pr_target_branch varchar(255) NULL,
    pr_head_commit varchar(64) NULL,
    pr_refreshed_at varchar(64) NULL,
    CHECK ((pr_url IS NULL AND pr_number IS NULL AND pr_state IS NULL)
        OR (pr_url IS NOT NULL AND pr_number IS NOT NULL AND pr_state IS NOT NULL)),
    CHECK (pr_refreshed_at IS NULL OR pr_state IS NOT NULL),
    UNIQUE (module_id, operation_id)
);
CREATE TRIGGER ticketry_shiprecords_commit_shas_lowercase
    BEFORE INSERT ON ticketry_shiprecords
BEGIN
    SELECT RAISE(ABORT, 'ship record commit SHAs must be full and lowercase')
    WHERE EXISTS (
        SELECT 1 FROM json_each(NEW.commit_shas)
        WHERE LENGTH(value) != 40
           OR value != LOWER(value)
           OR typeof(value) != 'text'
    );
END;
CREATE TRIGGER ticketry_shiprecords_pr_state_open_to_terminal
    BEFORE UPDATE OF pr_state, pr_target_branch, pr_head_commit, pr_refreshed_at, pr_url, pr_number ON ticketry_shiprecords
BEGIN
    SELECT RAISE(ABORT, 'ship record PR state moves only from open to merged or closed')
    WHERE (
            (OLD.pr_state IS NULL AND NEW.pr_state IS NOT NULL)
            OR (OLD.pr_state = 'merged' AND NEW.pr_state IS NOT 'merged')
            OR (OLD.pr_state = 'closed' AND NEW.pr_state IS NOT 'closed')
            OR (OLD.pr_state = 'open' AND NEW.pr_state NOT IN ('merged', 'closed'))
        )
       OR (
            NEW.pr_url IS NOT OLD.pr_url
            OR NEW.pr_number IS NOT OLD.pr_number
            OR NEW.pr_target_branch IS NOT OLD.pr_target_branch
            OR NEW.pr_head_commit IS NOT OLD.pr_head_commit
        )
       OR (
            (NEW.pr_refreshed_at IS NULL) != (NEW.pr_state IS NULL)
        );
END;
"#;

async fn write_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    database
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (
singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
version INTEGER NOT NULL CHECK (version = {VERSION}),
migration_id TEXT NOT NULL,
source_commit TEXT NOT NULL,
applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)"
        ))
        .await?;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO {LEDGER_TABLE}
(singleton, version, migration_id, source_commit) VALUES (1, ?, ?, ?)"
            ),
            [VERSION.into(), MIGRATION_ID.into(), SOURCE_COMMIT.into()],
        ))
        .await?;
    Ok(())
}

async fn verify_shape(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !table_exists(database, SHIP_RECORD_TABLE).await? {
        return Err(DbErr::Custom(
            "ship-record migration ledger exists without its table".to_owned(),
        ));
    }
    for column in [
        "id",
        "module_id",
        "task_id",
        "checkout_kind",
        "checkout_label",
        "operation_id",
        "branch",
        "commit_shas",
        "steps",
        "acted_at",
        "pr_url",
        "pr_number",
        "pr_state",
        "pr_target_branch",
        "pr_head_commit",
        "pr_refreshed_at",
    ] {
        if !column_exists(database, SHIP_RECORD_TABLE, column).await? {
            return Err(DbErr::Custom(format!(
                "ship-record table is missing {column}"
            )));
        }
    }
    Ok(())
}

async fn verify_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, migration_id, source_commit
FROM {LEDGER_TABLE} WHERE singleton = 1"
            ),
        ))
        .await?
        .ok_or_else(|| DbErr::Custom("ship-record migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported ship-record migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}

async fn column_exists(
    database: &impl ConnectionTrait,
    table: &str,
    column: &str,
) -> Result<bool, DbErr> {
    Ok(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info({table})"),
        ))
        .await?
        .into_iter()
        .any(|row| {
            row.try_get::<String>("", "name")
                .is_ok_and(|name| name == column)
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
