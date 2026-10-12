//! Disposable SQLite databases holding just the provider-catalog tables.

use sea_orm::{
    ColumnTrait, ConnectionTrait, Database, DatabaseConnection, EntityTrait, QueryFilter,
};
use tempfile::TempDir;

use ticketry_entities::{agent_model, agent_model_reasoning_level, reasoning_level};

pub(super) const PROVIDER: &str = "CREATE TABLE worktracker_provider (\
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, activated INTEGER NOT NULL, \
    supports_unattended INTEGER NOT NULL)";
pub(super) const AGENT_MODEL: &str = "CREATE TABLE worktracker_agentmodel (\
    id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, \
    name TEXT NOT NULL, UNIQUE (provider_id, name))";
pub(super) const REASONING_LEVEL: &str = "CREATE TABLE worktracker_reasoninglevel (\
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)";
pub(super) const AGENT_MODEL_REASONING_LEVEL: &str =
    "CREATE TABLE worktracker_agentmodelreasoninglevel (\
    id INTEGER PRIMARY KEY AUTOINCREMENT, \
    agent_model_id TEXT NOT NULL, \
    reasoning_level_id TEXT NOT NULL, \
    UNIQUE (agent_model_id, reasoning_level_id))";
pub(super) const ALL_TABLES: &[&str] = &[
    PROVIDER,
    AGENT_MODEL,
    REASONING_LEVEL,
    AGENT_MODEL_REASONING_LEVEL,
];

pub(super) async fn open(tables: &[&str]) -> (TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create catalog database directory");
    let path = directory.path().join("catalog.db");
    let database = Database::connect(format!("sqlite://{}?mode=rwc", path.display()))
        .await
        .expect("open catalog database");
    for table in tables {
        database
            .execute_unprepared(table)
            .await
            .expect("create catalog table");
    }
    (directory, database)
}

pub(super) async fn with_codex(tables: &[&str]) -> (TempDir, DatabaseConnection) {
    let (directory, database) = open(tables).await;
    database
        .execute_unprepared(
            "INSERT INTO worktracker_provider (id, slug, activated, supports_unattended) \
             VALUES ('codex-id', 'codex', 1, 1)",
        )
        .await
        .expect("seed codex provider");
    (directory, database)
}

pub(super) async fn table_exists(database: &DatabaseConnection, table: &str) -> bool {
    let row = database
        .query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .expect("query sqlite_master")
        .expect("count row");
    row.try_get::<i64>("", "count").expect("count") == 1
}

/// The reasoning level names joined to `model`, sorted, or `None` when absent.
pub(super) async fn reasoning_for(
    database: &DatabaseConnection,
    model: &str,
) -> Option<Vec<String>> {
    let model = agent_model::Entity::find()
        .filter(agent_model::Column::Name.eq(model))
        .one(database)
        .await
        .expect("find model")?;
    let joins = agent_model_reasoning_level::Entity::find()
        .filter(agent_model_reasoning_level::Column::AgentModelId.eq(&model.id))
        .all(database)
        .await
        .expect("find joins");
    let mut names = Vec::new();
    for join in joins {
        let level = reasoning_level::Entity::find_by_id(join.reasoning_level_id)
            .one(database)
            .await
            .expect("find level")
            .expect("joined level exists");
        names.push(level.name);
    }
    names.sort();
    Some(names)
}

pub(super) async fn model_count(database: &DatabaseConnection) -> u64 {
    use sea_orm::PaginatorTrait;
    agent_model::Entity::find()
        .count(database)
        .await
        .expect("count models")
}
