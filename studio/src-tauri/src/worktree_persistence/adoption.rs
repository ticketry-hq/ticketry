use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::schema::{
    self, ADOPTED_TABLE, CURRENT_DJANGO_LEAF, DJANGO_MIGRATIONS, LEDGER_TABLE, LIFECYCLE_STATES,
    WORKTREE_COLUMNS,
};
use super::{WorktreePersistenceError, WorktreePersistenceErrorCode};

const SNAPSHOT_GENERATIONS: usize = 3;

/// Who last migrated the `worktrees` table in the observed database.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "owner", content = "generation")]
pub enum SourceClassification {
    /// Django's only Worktree generation: the initial migration.
    Django(&'static str),
    RustOwned,
}

/// Durable proof that adoption preserved every existing Worktree row.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub stable_digest: String,
    pub row_count: u64,
    pub snapshot_path: Option<PathBuf>,
    pub snapshot_sha256: Option<String>,
    pub restoration_verified: bool,
}

/// Read-only proof used before any schema or ownership mutation.
pub async fn preflight(
    data_directory: &Path,
) -> Result<SourceClassification, WorktreePersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    stable_digest(&database).await?;
    database.close().await.map_err(storage)?;
    Ok(source)
}

/// Adopt only an explicitly supplied SQLite store. Desktop startup does not
/// call this function until the Slice 4 one-writer handoff ticket.
pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, WorktreePersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let before = stable_digest(&database).await?;
    let rows = row_count(&database).await?;
    database.close().await.map_err(storage)?;

    if source == SourceClassification::RustOwned {
        return Ok(AdoptionEvidence {
            version: schema::VERSION,
            source,
            stable_digest: before,
            row_count: rows,
            snapshot_path: None,
            snapshot_sha256: None,
            restoration_verified: true,
        });
    }

    let checkpoint = connect(&path, false).await?;
    checkpoint
        .execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE)")
        .await
        .map_err(storage)?;
    checkpoint.close().await.map_err(storage)?;
    let snapshot_path = rotate_snapshot(data_directory, &path)?;
    let snapshot_sha256 = file_sha256(&snapshot_path)?;
    verify_snapshot(&snapshot_path, source, &before).await?;

    let writable = connect(&path, false).await?;
    let SourceClassification::Django(leaf) = source else {
        unreachable!("Rust-owned stores return before the ledger is installed")
    };
    schema::install(&writable, leaf, &before).await?;
    writable.close().await.map_err(storage)?;

    // Restart verification: everything is re-proved on a freshly opened
    // connection, so the adopted store is known to reopen deterministically.
    let reopened = connect(&path, true).await?;
    integrity(&reopened).await?;
    let installed = classify(&reopened).await?;
    if installed != SourceClassification::RustOwned {
        return Err(incompatible("Worktree ownership ledger was not installed"));
    }
    validate_manifest(&reopened, installed).await?;
    validate_semantics(&reopened).await?;
    let after = stable_digest(&reopened).await?;
    let after_rows = row_count(&reopened).await?;
    reopened.close().await.map_err(storage)?;
    if after != before || after_rows != rows {
        return Err(invalid(
            "Worktree metadata changed while installing the persistence seam",
        ));
    }

    let evidence = AdoptionEvidence {
        version: schema::VERSION,
        source,
        stable_digest: before,
        row_count: rows,
        snapshot_path: Some(snapshot_path),
        snapshot_sha256: Some(snapshot_sha256),
        restoration_verified: true,
    };
    write_evidence(data_directory, &evidence)?;
    Ok(evidence)
}

async fn classify(
    database: &impl ConnectionTrait,
) -> Result<SourceClassification, WorktreePersistenceError> {
    if table_exists(database, LEDGER_TABLE).await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT version FROM {LEDGER_TABLE} WHERE singleton=1"),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| incompatible("Worktree ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(storage)?;
        if version != schema::VERSION {
            return Err(incompatible(format!(
                "unknown Rust Worktree schema version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    if !table_exists(database, "django_migrations").await? {
        return Err(incompatible(
            "Worktree adoption requires Django migration history",
        ));
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app='worktrees' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(storage)?;
    let migrations = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<Vec<_>, _>>()?;
    if migrations != DJANGO_MIGRATIONS {
        return Err(incompatible(
            "unknown Worktree migration history; no named bridge matches",
        ));
    }
    Ok(SourceClassification::Django(CURRENT_DJANGO_LEAF))
}

async fn validate_manifest(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), WorktreePersistenceError> {
    let observed = schema::columns(database, ADOPTED_TABLE).await?;
    let expected = WORKTREE_COLUMNS
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<BTreeSet<_>>();
    if observed != expected {
        return Err(incompatible(format!(
            "unknown schema for {ADOPTED_TABLE}: observed {observed:?}"
        )));
    }
    if source == SourceClassification::RustOwned && !table_exists(database, LEDGER_TABLE).await? {
        return Err(incompatible(format!(
            "Rust Worktree schema is missing {LEDGER_TABLE}"
        )));
    }
    Ok(())
}

async fn validate_semantics(
    database: &impl ConnectionTrait,
) -> Result<(), WorktreePersistenceError> {
    let states = LIFECYCLE_STATES
        .iter()
        .map(|state| format!("'{state}'"))
        .collect::<Vec<_>>()
        .join(",");
    let checks = [
        (
            "Worktree required identity",
            "SELECT COUNT(*) AS count FROM worktrees WHERE id='' OR task_id=''".to_owned(),
        ),
        (
            "Worktree Git identity",
            "SELECT COUNT(*) AS count FROM worktrees WHERE repo_root='' OR path='' OR branch='' OR base_branch='' OR base_commit=''".to_owned(),
        ),
        (
            "Worktree checkout roots",
            "SELECT COUNT(*) AS count FROM worktrees WHERE repo_root NOT LIKE '/%' OR path NOT LIKE '/%'".to_owned(),
        ),
        (
            "Worktree lifecycle state",
            format!("SELECT COUNT(*) AS count FROM worktrees WHERE status NOT IN ({states})"),
        ),
        (
            "Worktree timestamps",
            "SELECT COUNT(*) AS count FROM worktrees WHERE created_at='' OR updated_at=''".to_owned(),
        ),
        (
            "Worktree owner scope",
            "SELECT COUNT(*) AS count FROM worktrees w LEFT JOIN worktracker_issue i ON i.id=w.task_id WHERE i.id IS NULL".to_owned(),
        ),
        (
            "Worktree owner uniqueness",
            "SELECT COUNT(*) AS count FROM (SELECT task_id FROM worktrees GROUP BY task_id HAVING COUNT(*) > 1)".to_owned(),
        ),
    ];
    for (label, query) in checks {
        let row = database
            .query_one_raw(Statement::from_string(DbBackend::Sqlite, query))
            .await
            .map_err(storage)?
            .expect("count query returns a row");
        let count = row.try_get::<i64>("", "count").map_err(storage)?;
        if count != 0 {
            return Err(invalid(format!(
                "semantically invalid {label}: {count} row(s)"
            )));
        }
    }
    Ok(())
}

async fn stable_digest(
    database: &impl ConnectionTrait,
) -> Result<String, WorktreePersistenceError> {
    let expression = WORKTREE_COLUMNS
        .iter()
        .map(|column| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(",");
    let query =
        format!("SELECT json_array({expression}) AS row_data FROM {ADOPTED_TABLE} ORDER BY id");
    let mut hasher = Sha256::new();
    hasher.update(ADOPTED_TABLE.as_bytes());
    for row in database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .map_err(storage)?
    {
        hasher.update(
            row.try_get::<String>("", "row_data")
                .map_err(storage)?
                .as_bytes(),
        );
        hasher.update(b"\n");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn row_count(database: &impl ConnectionTrait) -> Result<u64, WorktreePersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {ADOPTED_TABLE}"),
        ))
        .await
        .map_err(storage)?
        .expect("count query returns a row");
    Ok(row.try_get::<i64>("", "count").map_err(storage)? as u64)
}

async fn verify_snapshot(
    path: &Path,
    source: SourceClassification,
    expected_digest: &str,
) -> Result<(), WorktreePersistenceError> {
    let database = connect(path, true).await?;
    integrity(&database).await?;
    if classify(&database).await? != source {
        return Err(incompatible("Worktree snapshot classification changed"));
    }
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let digest = stable_digest(&database).await?;
    database.close().await.map_err(storage)?;
    if digest != expected_digest {
        return Err(invalid("Worktree snapshot changed historical rows"));
    }
    Ok(())
}

async fn integrity(database: &impl ConnectionTrait) -> Result<(), WorktreePersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await
        .map_err(storage)?
        .ok_or_else(|| invalid("SQLite integrity check returned no result"))?;
    if row
        .try_get::<String>("", "integrity_check")
        .map_err(storage)?
        != "ok"
    {
        return Err(invalid("SQLite integrity check failed"));
    }
    Ok(())
}

/// Whether the Worktree ownership ledger has been installed in this database.
pub async fn worktrees_adopted(database: &impl ConnectionTrait) -> bool {
    table_exists(database, LEDGER_TABLE).await.unwrap_or(false)
}

async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, WorktreePersistenceError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .map_err(storage)?
        .expect("count query returns a row");
    Ok(row.try_get::<i64>("", "count").map_err(storage)? == 1)
}

fn checked_database_path(data_directory: &Path) -> Result<PathBuf, WorktreePersistenceError> {
    let path = data_directory.join("state.db");
    if !path.is_file() {
        return Err(unavailable(
            "Worktree adoption requires an existing SQLite state.db",
        ));
    }
    for checked in [data_directory, path.as_path()] {
        if fs::symlink_metadata(checked)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(unavailable("Worktree adoption refuses symlinked storage"));
        }
    }
    Ok(path)
}

async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, WorktreePersistenceError> {
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

fn rotate_snapshot(directory: &Path, database: &Path) -> Result<PathBuf, WorktreePersistenceError> {
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let older = directory.join(format!("state.db.pre-rust-worktrees.{generation}"));
        let newer = directory.join(format!("state.db.pre-rust-worktrees.{}", generation + 1));
        if older.exists() {
            fs::rename(&older, &newer).map_err(io_error)?;
        }
    }
    let path = directory.join("state.db.pre-rust-worktrees.1");
    fs::copy(database, &path).map_err(io_error)?;
    Ok(path)
}

fn file_sha256(path: &Path) -> Result<String, WorktreePersistenceError> {
    let bytes = fs::read(path).map_err(io_error)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn write_evidence(
    directory: &Path,
    evidence: &AdoptionEvidence,
) -> Result<(), WorktreePersistenceError> {
    let destination = directory.join("worktree-adoption.json");
    let temporary = directory.join(format!(".worktree-adoption.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(io_error)?;
    serde_json::to_writer_pretty(&mut file, evidence)
        .map_err(|error| unavailable(error.to_string()))?;
    file.write_all(b"\n").map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    fs::rename(temporary, destination).map_err(io_error)
}

fn storage(source: sea_orm::DbErr) -> WorktreePersistenceError {
    WorktreePersistenceError::storage("Worktree adoption storage operation failed", source)
}
fn io_error(source: std::io::Error) -> WorktreePersistenceError {
    unavailable(format!("Worktree adoption file operation failed: {source}"))
}
fn unavailable(message: impl Into<String>) -> WorktreePersistenceError {
    WorktreePersistenceError::new(WorktreePersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> WorktreePersistenceError {
    WorktreePersistenceError::new(WorktreePersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> WorktreePersistenceError {
    WorktreePersistenceError::new(WorktreePersistenceErrorCode::InvalidMetadata, message)
}
