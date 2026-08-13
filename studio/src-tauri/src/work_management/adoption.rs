//! Fail-closed WorkTracker adoption and recovery evidence.

use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::ownership_manifest::{CURRENT_DJANGO_LEAF, OWNED_TABLES, VERSION};

const SNAPSHOT_GENERATIONS: usize = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceClassification {
    DjangoCurrent,
    RustOwned,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub snapshot_path: Option<PathBuf>,
    pub snapshot_sha256: Option<String>,
    pub stable_digest: String,
    pub restoration_verified: bool,
}

#[derive(Debug)]
pub struct AdoptionError(String);

impl AdoptionError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl std::fmt::Display for AdoptionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AdoptionError {}

pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, AdoptionError> {
    reject_postgresql(data_directory)?;
    let database_path = data_directory.join("state.db");
    reject_unsafe_path(data_directory, &database_path)?;
    if !database_path.is_file() {
        return Err(AdoptionError::new(
            "WorkTracker adoption requires a provisioned SQLite state.db; PostgreSQL and unknown empty inputs are not mutated.",
        ));
    }

    let database = connect(&database_path, false).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database).await?;
    validate_semantics(&database).await?;
    let before = stable_digest(&database).await?;

    if source == SourceClassification::RustOwned {
        return Ok(AdoptionEvidence {
            version: VERSION,
            source,
            snapshot_path: None,
            snapshot_sha256: None,
            stable_digest: before,
            restoration_verified: true,
        });
    }

    checkpoint(&database).await?;
    database.close().await.map_err(sqlite_error)?;
    let snapshot_path = rotate_snapshot(data_directory, &database_path)?;
    let snapshot_sha256 = file_sha256(&snapshot_path)?;
    let snapshot = connect(&snapshot_path, true).await?;
    integrity(&snapshot).await?;
    validate_manifest(&snapshot).await?;
    let snapshot_digest = stable_digest(&snapshot).await?;
    snapshot.close().await.map_err(sqlite_error)?;
    if snapshot_digest != before {
        return Err(AdoptionError::new(
            "verified snapshot digest does not match the classified source",
        ));
    }
    prove_restoration(data_directory, &snapshot_path, &before).await?;

    let writable = connect(&database_path, false).await?;
    super::transition_occurrences::ensure_schema(&writable)
        .await
        .map_err(sqlite_error)?;
    install_ledger(&writable, &snapshot_path, &snapshot_sha256, &before).await?;
    validate_manifest(&writable).await?;
    validate_semantics(&writable).await?;
    let after = stable_digest(&writable).await?;
    if after != before {
        return Err(AdoptionError::new("post-adoption stable digest changed"));
    }
    writable.close().await.map_err(sqlite_error)?;

    let evidence = AdoptionEvidence {
        version: VERSION,
        source,
        snapshot_path: Some(snapshot_path),
        snapshot_sha256: Some(snapshot_sha256),
        stable_digest: before,
        restoration_verified: true,
    };
    write_evidence(data_directory, &evidence)?;
    Ok(evidence)
}

fn reject_postgresql(data_directory: &Path) -> Result<(), AdoptionError> {
    let marker = data_directory.join("database-url");
    let enabled_marker = data_directory.join("database-url.enabled");
    if enabled_marker.is_file() && marker.is_file() {
        let value = fs::read_to_string(&marker).map_err(io_error)?;
        if value.trim_start().starts_with("postgres") {
            return Err(AdoptionError::new(
                "This release adopts WorkTracker only from SQLite; PostgreSQL is left untouched and requires an acceptance-tested import.",
            ));
        }
    }
    Ok(())
}

fn reject_unsafe_path(data_directory: &Path, database: &Path) -> Result<(), AdoptionError> {
    if fs::symlink_metadata(data_directory)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(AdoptionError::new(
            "WorkTracker adoption refuses a symlinked data directory",
        ));
    }
    if fs::symlink_metadata(database)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(AdoptionError::new(
            "WorkTracker adoption refuses a symlinked state.db",
        ));
    }
    Ok(())
}

async fn connect(path: &Path, read_only: bool) -> Result<DatabaseConnection, AdoptionError> {
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
    Database::connect(options).await.map_err(sqlite_error)
}

async fn integrity(database: &DatabaseConnection) -> Result<(), AdoptionError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await
        .map_err(sqlite_error)?
        .ok_or_else(|| AdoptionError::new("SQLite integrity check returned no result"))?;
    let result = row
        .try_get::<String>("", "integrity_check")
        .map_err(sqlite_error)?;
    if result != "ok" {
        return Err(AdoptionError::new(format!(
            "SQLite integrity check failed: {result}"
        )));
    }
    let violations = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .map_err(sqlite_error)?;
    if !violations.is_empty() {
        return Err(AdoptionError::new(format!(
            "SQLite foreign-key check found {} violation(s)",
            violations.len()
        )));
    }
    Ok(())
}

async fn classify(database: &DatabaseConnection) -> Result<SourceClassification, AdoptionError> {
    if table_exists(database, "ticketry_worktracker_adoption").await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM ticketry_worktracker_adoption WHERE singleton = 1".to_owned(),
            ))
            .await
            .map_err(sqlite_error)?
            .ok_or_else(|| AdoptionError::new("Rust ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(sqlite_error)?;
        if version != VERSION {
            return Err(AdoptionError::new(format!(
                "unknown Rust WorkTracker ownership version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app = 'worktracker' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(sqlite_error)?;
    let migrations = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(sqlite_error))
        .collect::<Result<BTreeSet<_>, _>>()?;
    if migrations.contains(CURRENT_DJANGO_LEAF) {
        Ok(SourceClassification::DjangoCurrent)
    } else {
        Err(AdoptionError::new("unknown or historical WorkTracker schema; no named bridge matches this migration history"))
    }
}

async fn validate_manifest(database: &DatabaseConnection) -> Result<(), AdoptionError> {
    for (table, expected) in OWNED_TABLES {
        let query = format!("PRAGMA table_info('{table}')");
        let rows = database
            .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
            .await
            .map_err(sqlite_error)?;
        let actual = rows
            .into_iter()
            .map(|row| row.try_get::<String>("", "name").map_err(sqlite_error))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let expected = expected
            .iter()
            .map(|column| (*column).to_owned())
            .collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(AdoptionError::new(format!(
                "unknown schema for {table}: expected {expected:?}, observed {actual:?}"
            )));
        }
    }
    Ok(())
}

async fn validate_semantics(database: &DatabaseConnection) -> Result<(), AdoptionError> {
    let checks = [
        ("project sequence counters", "SELECT COUNT(*) AS count FROM worktracker_project p WHERE p.seq_counter < COALESCE((SELECT MAX(i.sequence_id) FROM worktracker_issue i WHERE i.project_id = p.id), 0)"),
        ("cross-project issue catalogues", "SELECT COUNT(*) AS count FROM worktracker_issue i JOIN worktracker_issuetype t ON t.id=i.issue_type_id WHERE i.project_id<>t.project_id"),
        ("cross-project issue states", "SELECT COUNT(*) AS count FROM worktracker_issue i JOIN worktracker_state s ON s.id=i.state_id WHERE i.project_id<>s.project_id"),
        ("cross-project parents", "SELECT COUNT(*) AS count FROM worktracker_issue i JOIN worktracker_issue p ON p.id=i.parent_id WHERE i.project_id<>p.project_id OR i.id=p.id"),
        ("cross-project modules", "SELECT COUNT(*) AS count FROM worktracker_issue i JOIN worktracker_issue m ON m.id=i.module_id WHERE i.project_id<>m.project_id OR m.type<>'module'"),
        ("invalid blocker endpoints", "SELECT COUNT(*) AS count FROM worktracker_issue_blocked_by b JOIN worktracker_issue a ON a.id=b.from_issue_id JOIN worktracker_issue z ON z.id=b.to_issue_id WHERE a.project_id<>z.project_id OR a.id=z.id"),
    ];
    for (label, query) in checks {
        let row = database
            .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
            .await
            .map_err(sqlite_error)?
            .ok_or_else(|| {
                AdoptionError::new(format!("semantic check returned no row: {label}"))
            })?;
        let count = row.try_get::<i64>("", "count").map_err(sqlite_error)?;
        if count != 0 {
            return Err(AdoptionError::new(format!(
                "semantic preflight rejected {count} {label}"
            )));
        }
    }
    Ok(())
}

async fn stable_digest(database: &DatabaseConnection) -> Result<String, AdoptionError> {
    let mut hasher = Sha256::new();
    for (table, columns) in OWNED_TABLES {
        hasher.update(table.as_bytes());
        let quoted = columns
            .iter()
            .map(|column| format!("quote(\"{column}\")"))
            .collect::<Vec<_>>()
            .join(" || '|' || ");
        let order = if columns.contains(&"id") {
            "id"
        } else {
            columns[0]
        };
        let query = format!("SELECT {quoted} AS stable_row FROM {table} ORDER BY \"{order}\"");
        let rows = database
            .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
            .await
            .map_err(sqlite_error)?;
        for row in rows {
            hasher.update(
                row.try_get::<String>("", "stable_row")
                    .map_err(sqlite_error)?
                    .as_bytes(),
            );
            hasher.update(b"\n");
        }
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

async fn checkpoint(database: &DatabaseConnection) -> Result<(), AdoptionError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA wal_checkpoint(TRUNCATE)".to_owned(),
        ))
        .await
        .map_err(sqlite_error)?
        .ok_or_else(|| AdoptionError::new("WAL checkpoint returned no result"))?;
    let busy = row.try_get_by_index::<i64>(0).map_err(sqlite_error)?;
    let log = row.try_get_by_index::<i64>(1).map_err(sqlite_error)?;
    let checkpointed = row.try_get_by_index::<i64>(2).map_err(sqlite_error)?;
    if busy != 0 || log != checkpointed {
        return Err(AdoptionError::new(format!(
            "WAL checkpoint remained busy (busy={busy}, log={log}, checkpointed={checkpointed})"
        )));
    }
    Ok(())
}

fn rotate_snapshot(data_directory: &Path, database: &Path) -> Result<PathBuf, AdoptionError> {
    let temporary = data_directory.join(format!(
        ".state.db.pre-rust-worktracker.{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let mut source = File::open(database).map_err(io_error)?;
    let mut destination = private_file(&temporary)?;
    std::io::copy(&mut source, &mut destination).map_err(io_error)?;
    destination.sync_all().map_err(io_error)?;
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let from = snapshot_path(data_directory, generation);
        let to = snapshot_path(data_directory, generation + 1);
        if from.exists() {
            fs::rename(from, to).map_err(io_error)?;
        }
    }
    let first = snapshot_path(data_directory, 1);
    fs::rename(&temporary, &first).map_err(io_error)?;
    File::open(data_directory)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    Ok(first)
}

async fn prove_restoration(
    data_directory: &Path,
    snapshot: &Path,
    expected: &str,
) -> Result<(), AdoptionError> {
    let candidate = data_directory.join(format!(
        ".state.db.restore-proof.{}.tmp",
        uuid::Uuid::new_v4()
    ));
    fs::copy(snapshot, &candidate).map_err(io_error)?;
    let result = async {
        let database = connect(&candidate, true).await?;
        integrity(&database).await?;
        let digest = stable_digest(&database).await?;
        database.close().await.map_err(sqlite_error)?;
        if digest != expected {
            return Err(AdoptionError::new(
                "snapshot restoration proof changed the stable digest",
            ));
        }
        Ok(())
    }
    .await;
    let _ = fs::remove_file(candidate);
    result
}

async fn install_ledger(
    database: &DatabaseConnection,
    snapshot: &Path,
    hash: &str,
    digest: &str,
) -> Result<(), AdoptionError> {
    database.execute_unprepared("CREATE TABLE ticketry_worktracker_adoption (singleton integer PRIMARY KEY CHECK (singleton = 1), version integer NOT NULL, source_class varchar(32) NOT NULL, source_digest char(64) NOT NULL, snapshot_path text NOT NULL, snapshot_sha256 char(64) NOT NULL, adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, write_enabled_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP)").await.map_err(sqlite_error)?;
    database.execute_raw(Statement::from_sql_and_values(DbBackend::Sqlite, "INSERT INTO ticketry_worktracker_adoption (singleton, version, source_class, source_digest, snapshot_path, snapshot_sha256) VALUES (1, ?, 'django-current', ?, ?, ?)", [VERSION.into(), digest.into(), snapshot.display().to_string().into(), hash.into()])).await.map_err(sqlite_error)?;
    Ok(())
}

fn write_evidence(data_directory: &Path, evidence: &AdoptionEvidence) -> Result<(), AdoptionError> {
    let path = data_directory.join("worktracker-cutover.json");
    let temporary =
        data_directory.join(format!(".worktracker-cutover.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = private_file(&temporary)?;
    let bytes = serde_json::to_vec_pretty(evidence).map_err(|error| {
        AdoptionError::new(format!("could not encode adoption evidence: {error}"))
    })?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(io_error)?;
    fs::rename(temporary, path).map_err(io_error)
}

async fn table_exists(database: &DatabaseConnection, table: &str) -> Result<bool, AdoptionError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .map_err(sqlite_error)?
        .ok_or_else(|| AdoptionError::new("schema inspection returned no row"))?;
    Ok(row.try_get::<i64>("", "count").map_err(sqlite_error)? == 1)
}

fn snapshot_path(data_directory: &Path, generation: usize) -> PathBuf {
    data_directory.join(format!("state.db.pre-rust-worktracker.{generation}"))
}

fn private_file(path: &Path) -> Result<File, AdoptionError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(io_error)
}

fn file_sha256(path: &Path) -> Result<String, AdoptionError> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn sqlite_error(error: impl std::fmt::Display) -> AdoptionError {
    AdoptionError::new(format!("WorkTracker adoption SQLite failure: {error}"))
}
fn io_error(error: std::io::Error) -> AdoptionError {
    AdoptionError::new(format!("WorkTracker adoption filesystem failure: {error}"))
}
