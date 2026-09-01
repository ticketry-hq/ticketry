//! Prove nothing else can write the installation before anything writes it.
//!
//! Two authorities have to agree. The data-directory lease is the application's
//! own answer to "is another Ticketry here", and it is the outer authority the
//! desktop already acquires. It says nothing about a Django or FastMCP process
//! that outlived its supervisor, or a `sqlite3` shell someone left open — those
//! hold no lease and would still be writing while the recovery snapshot was
//! copied, which is exactly how a snapshot ends up describing a state that
//! never existed.
//!
//! So the second authority is SQLite itself. The adoption connection takes the
//! database's write lock before anything else happens, and a second writer —
//! a Django request mid-transaction, a FastMCP tool, a `sqlite3` shell with an
//! open transaction — makes that fail as busy. The refusal is the kernel's
//! answer rather than a scan of the process table.
//!
//! The lock taken is the write lock, not whole-file exclusivity. A reader
//! cannot change what the snapshot will contain, and demanding that no
//! connection anywhere is attached would refuse a startup for something that
//! cannot affect the outcome. What a reader *can* do is hold the write-ahead
//! log open, and that is caught where it matters: a truncating checkpoint
//! reports itself busy while any reader is mid-transaction, and adoption
//! refuses on that rather than copying a database whose newest committed rows
//! are still outside it.

use std::path::Path;
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;

/// How long the exclusive open waits for a departing writer to let go.
///
/// Long enough that a supervisor shutting a sidecar down in the same startup
/// is not raced; short enough that a genuinely busy installation refuses
/// before the window appears.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Refuse when a live process other than this one holds the lease.
pub(crate) fn hold_lease(data_directory: &Path) -> Result<(), AdoptionFailure> {
    if let Some(owner) = ticketry_data_directory::live_lease_owner(data_directory) {
        if owner.pid != std::process::id() {
            return Err(AdoptionFailure::new(
                Phase::LeaseAcquisition,
                Refusal::LeaseUnavailable,
                format!(
                    "process {} holds the installation lease; adoption needs it exclusively",
                    owner.pid
                ),
            ));
        }
    }
    Ok(())
}

/// Open the installation as its only writer, or refuse it as busy.
pub(crate) async fn open_exclusive(
    database_path: &Path,
) -> Result<DatabaseConnection, AdoptionFailure> {
    let database = connect(database_path, false).await?;
    // An empty write transaction. It is the cheapest thing that must take the
    // database's write lock, which is precisely what a competing writer denies.
    for statement in ["BEGIN IMMEDIATE", "COMMIT"] {
        if let Err(error) = database.execute_unprepared(statement).await {
            let _ = database.close().await;
            return Err(busy(database_path, &error.to_string()));
        }
    }
    Ok(database)
}

/// Open a database for reading without claiming it.
///
/// Verification reads the recovery snapshot through this. The snapshot is a
/// file, not a live installation, so it is opened read-only: a writable open
/// would leave a write-ahead log and shared-memory index beside a recovery
/// point that is supposed to be exactly the bytes that were hashed.
pub(crate) async fn open_readable(
    database_path: &Path,
) -> Result<DatabaseConnection, AdoptionFailure> {
    connect(database_path, true).await
}

/// Open the installation for reading and writing, sharing it with readers.
pub(crate) async fn open_shared(
    database_path: &Path,
) -> Result<DatabaseConnection, AdoptionFailure> {
    connect(database_path, false).await
}

async fn connect(
    database_path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, AdoptionFailure> {
    let owned = database_path.to_owned();
    let mut options = ConnectOptions::new(if read_only {
        "sqlite://installation?mode=ro"
    } else {
        "sqlite://installation?mode=rw"
    });
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |sqlite| {
            sqlite
                .filename(owned.clone())
                .create_if_missing(false)
                .read_only(read_only)
                .busy_timeout(BUSY_TIMEOUT)
                .pragma("foreign_keys", "ON")
        });
    Database::connect(options)
        .await
        .map_err(|error| busy(database_path, &error.to_string()))
}

/// Read one integer PRAGMA or scalar, for the phases that verify their work.
pub(crate) async fn scalar(
    database: &DatabaseConnection,
    query: &str,
    column: usize,
) -> Result<i64, String> {
    let row = database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("{query} returned no row"))?;
    row.try_get_by_index::<i64>(column)
        .map_err(|error| error.to_string())
}

fn busy(database_path: &Path, detail: &str) -> AdoptionFailure {
    AdoptionFailure::new(
        Phase::WriterShutdown,
        Refusal::InstallationBusy,
        format!(
            "could not take the installation exclusively ({}): {detail}",
            database_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "state.db".to_owned())
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::BUSY_TIMEOUT;

    #[test]
    fn a_departing_writer_is_waited_for_but_not_indefinitely() {
        assert!(BUSY_TIMEOUT.as_secs() >= 1);
        assert!(BUSY_TIMEOUT.as_secs() <= 10);
    }
}
