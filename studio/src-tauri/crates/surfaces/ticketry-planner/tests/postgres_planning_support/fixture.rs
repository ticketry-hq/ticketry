//! Synthetic planning fixture only. This is not Ticketry's migration chain.

use std::time::Duration;

use sea_orm::{
    sea_query::{Alias, ColumnDef, Table},
    ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend,
    Schema, Set,
};
use ticketry_entities::{project, sprint, sprint_goal};

pub const PROJECT: &str = "20000000-0000-0000-0000-000000000001";

/// No DNS names, query parameters, implicit host, or remote credentials can
/// redirect this destructive fixture cleanup to a hosted database.
pub fn local_test_url(value: &str) -> Result<String, &'static str> {
    let url = reqwest::Url::parse(value).map_err(|_| "TEST_POSTGRES_URL must be a URL")?;
    if !matches!(url.scheme(), "postgres" | "postgresql")
        || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path().trim_matches('/').is_empty()
    {
        return Err("TEST_POSTGRES_URL requires postgres:// or postgresql://, literal 127.0.0.1 or [::1], a database name, and no query or fragment");
    }
    Ok(url.into())
}

pub async fn connect(url: &str, schema: Option<&str>) -> DatabaseConnection {
    let mut options = ConnectOptions::new(url);
    options
        .max_connections(4)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(5))
        .acquire_timeout(Duration::from_secs(5))
        .statement_timeout(Duration::from_secs(10))
        .sqlx_logging(false);
    if let Some(schema) = schema {
        // Every pool connection uses this schema, with no public fallback.
        options.set_schema_search_path(schema);
    }
    Database::connect(options)
        .await
        .unwrap_or_else(|_| panic!("Could not connect to the local test PostgreSQL database"))
}

pub async fn bootstrap(database: &DatabaseConnection) {
    let ddl = Schema::new(DbBackend::Postgres);
    // Sprint's unused nullable suggestion_run_id still retains its real FK.
    // This empty reference anchor deliberately does not claim run support.
    let run_reference = Table::create()
        .table(Alias::new("agent_runs"))
        .col(
            ColumnDef::new(Alias::new("id"))
                .string()
                .not_null()
                .primary_key(),
        )
        .to_owned();
    for table in [
        run_reference,
        ddl.create_table_from_entity(project::Entity),
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(sprint_goal::Entity),
    ] {
        database
            .execute_raw(DbBackend::Postgres.build(&table))
            .await
            .unwrap();
    }
    // Entity-derived DDL cannot infer these migration-owned constraints. Keep
    // their planning meaning in the fixture without calling SQLite migrations.
    database
        .execute_unprepared(
            "ALTER TABLE worktracker_sprint ADD CONSTRAINT sprint_status_check
            CHECK (status IN ('planned', 'active', 'completed'));
         CREATE UNIQUE INDEX sprint_one_active_per_project
            ON worktracker_sprint(project_id) WHERE status = 'active';
         CREATE UNIQUE INDEX sprint_goal_position
            ON worktracker_sprint_goal(sprint_id, position);",
        )
        .await
        .unwrap();
    let now = chrono::Utc::now().naive_utc();
    project::ActiveModel {
        id: Set(PROJECT.replace('-', "")),
        name: Set("Postgres planning fixture".to_owned()),
        slug: Set("PGP".to_owned()),
        description: Set(String::new()),
        seq_counter: Set(0),
        state_revision: Set(1),
        created_at: Set(now),
        updated_at: Set(now),
        onboarding_required: Set(false),
    }
    .insert(database)
    .await
    .unwrap();
}
