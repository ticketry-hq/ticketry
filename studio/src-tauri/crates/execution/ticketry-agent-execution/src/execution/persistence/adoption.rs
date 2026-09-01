use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use serde::Serialize;

use super::{evidence, inspection, schema};
use super::{ExecutionPersistenceError, ExecutionPersistenceErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "owner", content = "leaf")]
pub enum SourceClassification {
    Django(&'static str),
    RustOwned,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TableEvidence {
    pub row_count: i64,
    pub stable_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub tables: BTreeMap<String, TableEvidence>,
}

pub async fn preflight(
    data_directory: &Path,
) -> Result<SourceClassification, ExecutionPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    inspection::integrity(&database).await?;
    let source = inspection::classify(&database).await?;
    inspection::validate_manifest(&database, source).await?;
    inspection::validate_semantics(&database).await?;
    database.close().await.map_err(storage)?;
    Ok(source)
}

pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, ExecutionPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let read = connect(&path, true).await?;
    inspection::integrity(&read).await?;
    let source = inspection::classify(&read).await?;
    inspection::validate_manifest(&read, source).await?;
    inspection::validate_semantics(&read).await?;
    let historical_columns = evidence::evidence_columns(&read).await?;
    let before = evidence::table_evidence(&read, Some(&historical_columns)).await?;
    let digest = evidence::combined_digest(&before);
    read.close().await.map_err(storage)?;

    if source != SourceClassification::RustOwned {
        let SourceClassification::Django(leaf) = source else {
            unreachable!()
        };
        let writable = connect(&path, false).await?;
        schema::install(&writable, leaf, &digest).await?;
        inspection::integrity(&writable).await?;
        if inspection::classify(&writable).await? != SourceClassification::RustOwned {
            return Err(incompatible("Execution ownership ledger was not installed"));
        }
        inspection::validate_manifest(&writable, SourceClassification::RustOwned).await?;
        inspection::validate_semantics(&writable).await?;
        let after = evidence::table_evidence(&writable, Some(&historical_columns)).await?;
        for (table, evidence) in before {
            if after.get(&table) != Some(&evidence) {
                return Err(invalid(format!(
                    "{table} history changed while installing the Execution schema"
                )));
            }
        }
        writable.close().await.map_err(storage)?;
    }

    let verified = connect(&path, true).await?;
    let tables = evidence::table_evidence(&verified, None).await?;
    verified.close().await.map_err(storage)?;
    Ok(AdoptionEvidence {
        version: schema::VERSION,
        source,
        tables,
    })
}

fn checked_database_path(data_directory: &Path) -> Result<PathBuf, ExecutionPersistenceError> {
    let path = data_directory.join("state.db");
    if !path.is_file() {
        return Err(unavailable(
            "Execution adoption requires an existing SQLite state.db",
        ));
    }
    for checked in [data_directory, path.as_path()] {
        if fs::symlink_metadata(checked)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(unavailable("Execution adoption refuses symlinked storage"));
        }
    }
    Ok(path)
}

async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, ExecutionPersistenceError> {
    let owned = path.to_owned();
    let mut options = ConnectOptions::new(if read_only {
        "sqlite:state.db?mode=ro"
    } else {
        "sqlite:state.db?mode=rw"
    });
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(cfg!(debug_assertions))
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(owned.clone())
                .create_if_missing(false)
                .read_only(read_only)
                .busy_timeout(Duration::from_secs(5))
                .pragma("foreign_keys", "ON")
        });
    Database::connect(options).await.map_err(storage)
}

fn storage(source: sea_orm::DbErr) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(
        ExecutionPersistenceErrorCode::AdoptionUnavailable,
        format!("Execution adoption storage operation failed: {source}"),
    )
}
fn io_error(source: std::io::Error) -> ExecutionPersistenceError {
    unavailable(format!(
        "Execution adoption filesystem operation failed: {source}"
    ))
}
fn unavailable(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::InvalidHistory, message)
}
