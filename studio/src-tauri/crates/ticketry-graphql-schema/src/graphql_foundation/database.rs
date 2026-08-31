use std::path::Path;

use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;

use super::error::{FoundationInitializationError, FoundationInitializationErrorCode};
use super::migrations::Migrator;

pub async fn open(path: &Path) -> Result<DatabaseConnection, FoundationInitializationError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::DatabaseDirectory,
                format!(
                    "could not create the GraphQL foundation database directory {}: {error}",
                    parent.display()
                ),
            )
        })?;
    }

    let database_path = path.to_owned();
    let mut options = ConnectOptions::new("sqlite:rust-core.sqlite3?mode=rwc");
    options
        .max_connections(4)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(&database_path)
                .create_if_missing(true)
                .foreign_keys(true)
        });

    let database = Database::connect(options).await.map_err(|error| {
        FoundationInitializationError::new(
            FoundationInitializationErrorCode::DatabaseOpen,
            format!(
                "could not open the GraphQL foundation database {}: {error}",
                path.display()
            ),
        )
    })?;
    Migrator::up(&database, None).await.map_err(|error| {
        FoundationInitializationError::new(
            FoundationInitializationErrorCode::Migration,
            format!(
                "could not migrate the GraphQL foundation database {}: {error}",
                path.display()
            ),
        )
    })?;
    Ok(database)
}

pub async fn in_memory() -> Result<DatabaseConnection, FoundationInitializationError> {
    let database = Database::connect("sqlite::memory:")
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::DatabaseOpen,
                format!("could not open an in-memory foundation database: {error}"),
            )
        })?;
    Migrator::up(&database, None).await.map_err(|error| {
        FoundationInitializationError::new(
            FoundationInitializationErrorCode::Migration,
            format!("could not migrate an in-memory foundation database: {error}"),
        )
    })?;
    Ok(database)
}
