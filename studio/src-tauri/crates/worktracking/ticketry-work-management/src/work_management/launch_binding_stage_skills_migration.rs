//! Add and backfill the authoritative LaunchBinding.stage_skills list.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "0059_launch_binding_stage_skills";
pub const LEDGER_TABLE: &str = "ticketry_launch_binding_stage_skills_migration";

const BINDING_TABLE: &str = "worktracker_launchbinding";
const STAGE_SKILLS_COLUMN: &str = "stage_skills";

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        if table_exists(&transaction, BINDING_TABLE).await?
            && !column_exists(&transaction, BINDING_TABLE, STAGE_SKILLS_COLUMN).await?
        {
            return Err(DbErr::Custom(
                "stage-skills migration ledger exists but the column is absent".to_owned(),
            ));
        }
        if table_exists(&transaction, BINDING_TABLE).await?
            && column_exists(&transaction, BINDING_TABLE, "entry_skill").await?
        {
            transaction
                .execute_unprepared("ALTER TABLE worktracker_launchbinding DROP COLUMN entry_skill")
                .await?;
        }
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, BINDING_TABLE).await? {
        if !column_exists(&transaction, BINDING_TABLE, STAGE_SKILLS_COLUMN).await? {
            transaction
                .execute_unprepared(
                    "ALTER TABLE worktracker_launchbinding \
                     ADD COLUMN stage_skills text NOT NULL DEFAULT '[]' \
                     CHECK (json_valid(stage_skills) AND json_type(stage_skills) = 'array')",
                )
                .await?;
        }
        if column_exists(&transaction, BINDING_TABLE, "entry_skill").await? {
            let rows = transaction
                .query_all_raw(Statement::from_string(
                    DbBackend::Sqlite,
                    "SELECT id, entry_skill FROM worktracker_launchbinding".to_owned(),
                ))
                .await?;
            for row in rows {
                let id = row.try_get::<i64>("", "id")?;
                let entry_skill = row.try_get::<Option<String>>("", "entry_skill")?;
                let entry_skill = entry_skill
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned);
                let stage_skills = entry_skill.into_iter().collect::<Vec<_>>();
                transaction
                    .execute_raw(Statement::from_sql_and_values(
                        DbBackend::Sqlite,
                        "UPDATE worktracker_launchbinding SET stage_skills = ? WHERE id = ?",
                        [
                            serde_json::to_string(&stage_skills).unwrap().into(),
                            id.into(),
                        ],
                    ))
                    .await?;
            }
            transaction
                .execute_unprepared("ALTER TABLE worktracker_launchbinding DROP COLUMN entry_skill")
                .await?;
        }
    }
    transaction
        .execute_unprepared(&format!(
            "CREATE TABLE {LEDGER_TABLE} (\
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1), \
                version INTEGER NOT NULL CHECK (version = {VERSION}), \
                migration_id TEXT NOT NULL); \
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
            ticketry_settings::LAUNCH_BINDING_STAGE_SKILLS_LEDGER
        );
    }
}
