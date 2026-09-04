//! Identify the storage engine and open it without changing anything.
//!
//! The engine decision happens before any schema read, because a PostgreSQL
//! installation is an import source that Rust must never own or mutate, and a
//! symlinked data directory is not an installation Ticketry will adopt at all.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection};

use super::outcome::{ClassificationError, PostgresSource, Refusal};

/// The state database inside an installation's data directory.
pub(crate) const STATE_DATABASE: &str = "state.db";
/// The marker naming an alternate database, and the gate that enables it.
const DATABASE_URL_MARKER: &str = "database-url";
const DATABASE_URL_GATE: &str = "database-url.enabled";

/// What the data directory holds, before any schema is read.
pub(crate) enum Source {
    /// A SQLite state database at this path.
    Sqlite(PathBuf),
    /// A PostgreSQL installation, identified from its marker alone.
    Postgres(PostgresSource),
    /// Nothing has been provisioned yet.
    Unprovisioned,
}

/// Identify the source in `data_directory` without opening or writing to it.
pub(crate) fn detect(data_directory: &Path) -> Result<Source, ClassificationError> {
    reject_symlink(data_directory, "data directory")?;
    if let Some(source) = postgres_source(data_directory)? {
        return Ok(Source::Postgres(source));
    }
    let database = data_directory.join(STATE_DATABASE);
    if !database.exists() {
        return Ok(Source::Unprovisioned);
    }
    reject_symlink(&database, STATE_DATABASE)?;
    let length = fs::metadata(&database)
        .map_err(|error| {
            ClassificationError::new(
                Refusal::UnreadableInstallation,
                format!("could not read {STATE_DATABASE}: {error}"),
            )
        })?
        .len();
    // A zero-length file is what an interrupted first launch leaves behind.
    // SQLite treats it as a new empty database, and so does classification.
    if length == 0
        && !data_directory
            .join(format!("{STATE_DATABASE}-wal"))
            .exists()
    {
        return Ok(Source::Unprovisioned);
    }
    Ok(Source::Sqlite(database))
}

fn postgres_source(data_directory: &Path) -> Result<Option<PostgresSource>, ClassificationError> {
    let marker = data_directory.join(DATABASE_URL_MARKER);
    if !data_directory.join(DATABASE_URL_GATE).is_file() || !marker.is_file() {
        return Ok(None);
    }
    let value = fs::read_to_string(&marker).map_err(|error| {
        ClassificationError::new(
            Refusal::UnreadableInstallation,
            format!("could not read the {DATABASE_URL_MARKER} marker: {error}"),
        )
    })?;
    // Only the scheme is retained. The rest of a DSN carries credentials that
    // must never reach an adoption record or a support log.
    let scheme = value
        .trim()
        .split("://")
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(scheme.as_str(), "postgres" | "postgresql") {
        return Err(ClassificationError::new(
            Refusal::UnknownSchema,
            format!("the enabled {DATABASE_URL_MARKER} marker names an unsupported engine"),
        ));
    }
    Ok(Some(PostgresSource { marker, scheme }))
}

fn reject_symlink(path: &Path, described: &str) -> Result<(), ClassificationError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        ClassificationError::new(
            Refusal::UnreadableInstallation,
            format!("could not inspect the {described}: {error}"),
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(ClassificationError::new(
            Refusal::UnsafeInstallationPath,
            format!("classification refuses a symlinked {described}"),
        ));
    }
    Ok(())
}

/// Open `database` read-only.
///
/// The connection is opened with SQLite's read-only flag, so a pending
/// write-ahead log is still read as committed content while no page of the
/// database or its log can be rewritten. A refused installation therefore stays
/// byte-for-byte restorable.
///
/// SQLite itself creates an empty `-wal` and a `-shm` index beside a
/// write-ahead-log database for any reader, including this one. Neither holds
/// installation content: the index is rebuilt from the log on demand, and a
/// read-only connection cannot commit a frame to the log. Removing them under a
/// live connection is what actually corrupts an installation, so classification
/// leaves them where SQLite put them.
pub(crate) async fn open_read_only(
    database: &Path,
) -> Result<DatabaseConnection, ClassificationError> {
    let owned = database.to_owned();
    let mut options = ConnectOptions::new("sqlite:state.db?mode=ro");
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |options| {
            options
                .filename(owned.clone())
                .create_if_missing(false)
                .read_only(true)
                .busy_timeout(Duration::from_secs(5))
        });
    Database::connect(options).await.map_err(|error| {
        ClassificationError::new(
            Refusal::UnreadableInstallation,
            format!("could not open the installation read-only: {error}"),
        )
    })
}
