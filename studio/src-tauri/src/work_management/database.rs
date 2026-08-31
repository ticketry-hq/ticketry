use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};

use ticketry_data_directory::{established_data_directory, OwnershipError};

#[derive(Debug)]
pub enum ReadDatabaseError {
    DataDirectory(OwnershipError),
    Open { path: PathBuf, source: DbErr },
}

impl std::fmt::Display for ReadDatabaseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DataDirectory(error) => write!(formatter, "{error}"),
            Self::Open { path, source } => write!(
                formatter,
                "could not open Django's WorkTracker database {} read-only: {source}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for ReadDatabaseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::DataDirectory(error) => Some(error),
            Self::Open { source, .. } => Some(source),
        }
    }
}

pub fn state_database_path() -> Result<PathBuf, ReadDatabaseError> {
    established_data_directory()
        .map(|directory| directory.join("state.db"))
        .map_err(ReadDatabaseError::DataDirectory)
}

pub async fn open_established() -> Result<DatabaseConnection, ReadDatabaseError> {
    open(&state_database_path()?).await
}

/// Open an isolated WorkTracker fixture for authored-command verification.
///
/// The live desktop composition deliberately continues to call [`open`]
/// until the checked one-writer cutover. Keeping this constructor explicit
/// prevents merely landing command code from creating a second live writer.
pub async fn open_for_commands(path: &Path) -> Result<DatabaseConnection, ReadDatabaseError> {
    let database_path = path.to_owned();
    let mut options = ConnectOptions::new("sqlite:state.db?mode=rw");
    options
        .max_connections(8)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(&database_path)
                .create_if_missing(false)
                .busy_timeout(Duration::from_secs(5))
                .pragma("journal_mode", "WAL")
                .pragma("foreign_keys", "ON")
        });

    let database = Database::connect(options)
        .await
        .map_err(|source| ReadDatabaseError::Open {
            path: path.to_owned(),
            source,
        })?;
    crate::work_management::transition_occurrences::ensure_schema(&database)
        .await
        .map_err(|source| ReadDatabaseError::Open {
            path: path.to_owned(),
            source,
        })?;
    crate::work_management::launch_policy::ensure_schema(&database)
        .await
        .map_err(|source| ReadDatabaseError::Open {
            path: path.to_owned(),
            source,
        })?;
    Ok(database)
}

/// Open Django's existing SQLite database without creating or migrating it.
///
/// SQLite's read-only open flag is the primary guard. `query_only` is applied
/// independently to every pooled connection as defense in depth. The normal
/// SQLite pager remains enabled so committed rows in Django's WAL are visible.
pub async fn open(path: &Path) -> Result<DatabaseConnection, ReadDatabaseError> {
    let database_path = path.to_owned();
    let mut options = ConnectOptions::new("sqlite:state.db?mode=ro");
    options
        .max_connections(4)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(&database_path)
                .create_if_missing(false)
                .read_only(true)
                .busy_timeout(Duration::from_secs(5))
                .pragma("query_only", "ON")
        });

    Database::connect(options)
        .await
        .map_err(|source| ReadDatabaseError::Open {
            path: path.to_owned(),
            source,
        })
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ConnectionTrait, Database, DbBackend, EntityTrait, PaginatorTrait, Statement,
        TransactionTrait,
    };

    use super::{open, open_for_commands};
    use ticketry_entities::work_management::project;

    #[tokio::test]
    async fn connection_reads_wal_and_rejects_writes() {
        let directory = tempfile::tempdir().expect("create fixture directory");
        let path = directory.path().join("state.db");
        let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .expect("open fixture writer");
        writer
            .execute_unprepared(
                r#"
                PRAGMA journal_mode=WAL;
                CREATE TABLE worktracker_project (
                    id char(32) NOT NULL PRIMARY KEY,
                    name varchar(255) NOT NULL,
                    slug varchar(64) NOT NULL,
                    description text NOT NULL,
                    seq_counter integer NOT NULL,
                    state_revision bigint NOT NULL,
                    manual_module_order bool NOT NULL,
                    created_at datetime NOT NULL,
                    updated_at datetime NOT NULL,
                    onboarding_required bool NOT NULL
                );
                INSERT INTO worktracker_project VALUES
                    ('00000000000000000000000000000001', 'First', 'CDN', '', 0, 0, 0,
                     '2026-08-12 00:00:00', '2026-08-12 00:00:00', 0);
                "#,
            )
            .await
            .expect("create Django-shaped fixture");

        let reader = open(&path).await.expect("open read-only connection");
        writer
            .execute_unprepared(
                r#"INSERT INTO worktracker_project VALUES
                    ('00000000000000000000000000000002', 'Second', 'SEC', '', 0, 0, 0,
                     '2026-08-12 00:00:00', '2026-08-12 00:00:00', 0)"#,
            )
            .await
            .expect("commit a row to the WAL");

        let projects = project::Entity::find()
            .all(&reader)
            .await
            .expect("read rows including the committed WAL row");
        assert_eq!(projects.len(), 2);

        let query_only = reader
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "PRAGMA query_only".to_owned(),
            ))
            .await
            .expect("read query_only pragma")
            .expect("query_only row")
            .try_get::<i32>("", "query_only")
            .expect("decode query_only pragma");
        assert_eq!(query_only, 1);

        let write = reader
            .execute_unprepared("DELETE FROM worktracker_project")
            .await;
        assert!(write.is_err(), "read-only connection unexpectedly wrote");
        assert_eq!(
            project::Entity::find()
                .count(&writer)
                .await
                .expect("count fixture rows"),
            2
        );
    }

    #[tokio::test]
    async fn command_pool_writes_while_another_connection_is_reading() {
        let directory = tempfile::tempdir().expect("create fixture directory");
        let path = directory.path().join("state.db");
        let setup = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .expect("open fixture writer");
        setup
            .execute_unprepared("CREATE TABLE lock_probe (id integer PRIMARY KEY)")
            .await
            .expect("create lock probe");
        setup.close().await.expect("close fixture writer");

        let commands = open_for_commands(&path).await.expect("open command pool");
        let reader = commands.begin().await.expect("begin reader");
        reader
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT count(*) AS count FROM lock_probe".to_owned(),
            ))
            .await
            .expect("hold a read snapshot");

        commands
            .execute_unprepared("INSERT INTO lock_probe DEFAULT VALUES")
            .await
            .expect("write while the read snapshot remains open");
        reader.rollback().await.expect("close reader");

        let journal_mode = commands
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "PRAGMA journal_mode".to_owned(),
            ))
            .await
            .expect("read journal mode")
            .expect("journal mode row")
            .try_get::<String>("", "journal_mode")
            .expect("decode journal mode");
        assert_eq!(journal_mode, "wal");
    }
}
