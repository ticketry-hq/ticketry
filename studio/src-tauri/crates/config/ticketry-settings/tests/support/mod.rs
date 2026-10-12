//! Independent disposable database fixtures for the public catalog contract.
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use tempfile::TempDir;

pub async fn open(step: u32) -> (TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::connect(format!(
        "sqlite://{}?mode=rwc",
        directory.path().join("catalog.db").display()
    ))
    .await
    .unwrap();
    for sql in [
        "CREATE TABLE worktracker_provider (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, activated INTEGER NOT NULL, supports_unattended INTEGER NOT NULL)",
        "CREATE TABLE worktracker_agentmodel (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (provider_id, name))",
        "CREATE TABLE worktracker_reasoninglevel (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
        "CREATE TABLE worktracker_agentmodelreasoninglevel (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_model_id TEXT NOT NULL, reasoning_level_id TEXT NOT NULL, UNIQUE (agent_model_id, reasoning_level_id))",
        "INSERT INTO worktracker_provider VALUES ('codex-id', 'codex', 1, 1)",
    ] {
        database.execute_unprepared(sql).await.unwrap();
    }
    if step == 55 {
        database.execute_unprepared("INSERT INTO worktracker_agentmodel VALUES ('legacy-astra-id', 'codex-id', 'gpt-5.6-astra')").await.unwrap();
    }
    (directory, database)
}

pub async fn table_exists(database: &DatabaseConnection, table: &str) -> bool {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .unwrap()
        .unwrap();
    row.try_get::<i64>("", "count").unwrap() == 1
}

/// Identities as well as content are observed to detect destructive reruns.
pub async fn catalog_snapshot(database: &DatabaseConnection) -> Vec<Vec<String>> {
    let mut snapshot = Vec::new();
    for sql in [
        "SELECT id || ':' || provider_id || ':' || name AS value FROM worktracker_agentmodel ORDER BY id",
        "SELECT id || ':' || name AS value FROM worktracker_reasoninglevel ORDER BY id",
        "SELECT id || ':' || agent_model_id || ':' || reasoning_level_id AS value FROM worktracker_agentmodelreasoninglevel ORDER BY id",
    ] {
        let rows = database.query_all_raw(Statement::from_string(DbBackend::Sqlite, sql)).await.unwrap();
        snapshot.push(rows.into_iter().map(|row| row.try_get("", "value").unwrap()).collect());
    }
    snapshot
}

pub async fn catalog_contents(database: &DatabaseConnection) -> Vec<(String, Vec<String>)> {
    let models = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, name FROM worktracker_agentmodel ORDER BY name",
        ))
        .await
        .unwrap();
    let mut contents = Vec::new();
    for model in models {
        let id: String = model.try_get("", "id").unwrap();
        let name = model.try_get("", "name").unwrap();
        let rows = database.query_all_raw(Statement::from_sql_and_values(DbBackend::Sqlite,
            "SELECT r.name FROM worktracker_reasoninglevel r JOIN worktracker_agentmodelreasoninglevel j ON j.reasoning_level_id=r.id WHERE j.agent_model_id=? ORDER BY r.name", [id.into()])).await.unwrap();
        contents.push((
            name,
            rows.into_iter()
                .map(|row| row.try_get("", "name").unwrap())
                .collect(),
        ));
    }
    contents
}

/// Literal expectations from the catalog specs, independent of the registry.
pub fn expected_contents(step: u32) -> Vec<(String, Vec<String>)> {
    let six = &["high", "low", "max", "medium", "ultra", "xhigh"][..];
    let five = &["high", "low", "max", "medium", "xhigh"][..];
    let with_none = &["high", "low", "max", "medium", "none", "xhigh"][..];
    let models: &[(&str, &[&str])] = match step {
        44 => &[
            ("gpt-5.6-luna", five),
            ("gpt-5.6-sol", six),
            ("gpt-5.6-terra", six),
        ],
        51 => &[("gpt-5.3-codex-spark", &[])],
        54 => &[("gpt-5.6-astra", six)],
        55 => &[("gpt-6-astra", &[])],
        57 => &[("glm-5.3-flash", &[])],
        61 => &[("gpt-6-luna", with_none), ("gpt-6-sol", with_none)],
        62 => &[("gpt-6.1-sol", six)],
        _ => panic!("add independent catalog expectations for step {step}"),
    };
    models
        .iter()
        .map(|(name, levels)| {
            (
                (*name).to_owned(),
                levels.iter().map(|level| (*level).to_owned()).collect(),
            )
        })
        .collect()
}
