//! Add and populate LaunchBinding.entry_skill from migration 0047.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

use super::commands::reviewed_defaults;

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "0047_launch_binding_entry_skill";
pub const LEDGER_TABLE: &str = "ticketry_launch_binding_entry_skill_migration";
pub const SOURCE_COMMIT: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";

const BINDING_TABLE: &str = "worktracker_launchbinding";
const ENTRY_SKILL_COLUMN: &str = "entry_skill";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        if table_exists(&transaction, BINDING_TABLE).await?
            && !column_exists(&transaction, BINDING_TABLE, ENTRY_SKILL_COLUMN).await?
        {
            return Err(DbErr::Custom(
                "entry-skill migration ledger exists but the column is absent".to_owned(),
            ));
        }
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, BINDING_TABLE).await? {
        if !column_exists(&transaction, BINDING_TABLE, ENTRY_SKILL_COLUMN).await? {
            transaction
                .execute_unprepared(
                    "ALTER TABLE worktracker_launchbinding \
                     ADD COLUMN entry_skill varchar(128) NULL",
                )
                .await?;
        }
        if table_exists(&transaction, "worktracker_issuetype").await?
            && table_exists(&transaction, "worktracker_state").await?
        {
            seed_reviewed_entries(&transaction).await?;
        }
    }
    write_ledger(&transaction).await?;
    transaction.commit().await
}

async fn seed_reviewed_entries(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let seeds = reviewed_defaults::entry_skill_seeds()
        .map_err(|error| DbErr::Custom(format!("could not read reviewed defaults: {error}")))?;
    for (state_name, skill) in seeds {
        let rows = database
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT binding.id, binding.required_skills \
                 FROM worktracker_launchbinding AS binding \
                 JOIN worktracker_issuetype AS issue_type \
                   ON issue_type.id = binding.issue_type_id \
                 JOIN worktracker_state AS state ON state.id = binding.state_id \
                 WHERE issue_type.name IN ('Story', 'PathFind', 'Implementation') \
                   AND state.name = ? AND binding.entry_skill IS NULL",
                [state_name.into()],
            ))
            .await?;
        for row in rows {
            let id = row.try_get::<i64>("", "id")?;
            let required = row.try_get::<String>("", "required_skills")?;
            let required: serde_json::Value = serde_json::from_str(&required)
                .map_err(|error| DbErr::Custom(format!("invalid required_skills JSON: {error}")))?;
            if !required
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(&skill)))
            {
                continue;
            }
            database
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Sqlite,
                    "UPDATE worktracker_launchbinding SET entry_skill = ? WHERE id = ?",
                    [skill.clone().into(), id.into()],
                ))
                .await?;
        }
    }
    Ok(())
}

async fn write_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    database
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (\
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1), \
                version INTEGER NOT NULL CHECK (version = {VERSION}), \
                migration_id TEXT NOT NULL, source_commit TEXT NOT NULL, \
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

async fn verify_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, migration_id, source_commit FROM {LEDGER_TABLE} WHERE singleton=1"
            ),
        ))
        .await?
        .ok_or_else(|| DbErr::Custom("entry-skill migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported entry-skill migration {migration_id} at version {version}"
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
        .ok_or_else(|| DbErr::Custom("entry-skill table check returned no row".to_owned()))?;
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
mod ledger_name_tests {
    #[test]
    fn settings_adoption_probes_this_ledger_by_the_same_name() {
        assert_eq!(
            super::LEDGER_TABLE,
            ticketry_settings::LAUNCH_BINDING_ENTRY_SKILL_LEDGER,
            "settings adoption probes this ledger by name; keep the two in step"
        );
    }
}
