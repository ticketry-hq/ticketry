//! Read-only preflight and in-place adoption of the Design Document registry.
//!
//! The sequence is the established one: prove the store read-only, classify the
//! migration history against a named bridge, validate the column manifest and
//! row semantics, digest every preserved column, checkpoint the WAL, take and
//! verify a rotated snapshot, install the bridge and ownership ledger, then
//! re-verify classification, manifest, semantics, and digest before the
//! evidence file is written. Any schema this file does not recognise is refused
//! before a single mutation runs, so an unknown installation is left untouched.

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

use super::schema::{self, ADOPTED_COLUMN, DJANGO_COLUMNS, DOCUMENT_SCOPES};
use super::{DocumentsPersistenceError, DocumentsPersistenceErrorCode};

const SNAPSHOT_GENERATIONS: usize = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "owner", content = "generation")]
pub enum SourceClassification {
    /// Django's Documents app, identified by its migration leaf.
    Django(&'static str),
    RustOwned,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub stable_digest: String,
    pub snapshot_path: Option<PathBuf>,
    pub snapshot_sha256: Option<String>,
    pub restoration_verified: bool,
    /// Registered documents counted at adoption. Preservation evidence, not a
    /// live count.
    pub row_count: u64,
}

/// Read-only proof used before any schema or ownership mutation.
pub async fn preflight(
    data_directory: &Path,
) -> Result<SourceClassification, DocumentsPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    database.close().await.map_err(storage)?;
    Ok(source)
}

/// Adopt only an explicitly supplied SQLite store. Desktop startup does not
/// call this function until the Documents one-writer handoff ticket.
pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, DocumentsPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let before = stable_digest(&database).await?;
    let row_count = registered_rows(&database).await?;
    database.close().await.map_err(storage)?;

    if source == SourceClassification::RustOwned {
        return Ok(AdoptionEvidence {
            version: schema::VERSION,
            source,
            stable_digest: before,
            snapshot_path: None,
            snapshot_sha256: None,
            restoration_verified: true,
            row_count,
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
    schema::install(&writable, &before).await?;
    integrity(&writable).await?;
    let installed = classify(&writable).await?;
    if installed != SourceClassification::RustOwned {
        return Err(incompatible("Documents ownership ledger was not installed"));
    }
    validate_manifest(&writable, installed).await?;
    validate_semantics(&writable).await?;
    let after = stable_digest(&writable).await?;
    let after_rows = registered_rows(&writable).await?;
    writable.close().await.map_err(storage)?;
    if after_rows != row_count {
        return Err(invalid(
            "Design Document rows were added or removed while installing the persistence seam",
        ));
    }
    if after != before {
        return Err(invalid(
            "Design Document rows changed while installing the persistence seam",
        ));
    }

    let evidence = AdoptionEvidence {
        version: schema::VERSION,
        source,
        stable_digest: before,
        snapshot_path: Some(snapshot_path),
        snapshot_sha256: Some(snapshot_sha256),
        restoration_verified: true,
        row_count,
    };
    write_evidence(data_directory, &evidence)?;
    Ok(evidence)
}

async fn classify(
    database: &impl ConnectionTrait,
) -> Result<SourceClassification, DocumentsPersistenceError> {
    if table_exists(database, schema::LEDGER_TABLE).await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!(
                    "SELECT version FROM {} WHERE singleton=1",
                    schema::LEDGER_TABLE
                ),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| incompatible("Documents ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(storage)?;
        if version != schema::VERSION {
            return Err(incompatible(format!(
                "unknown Rust Documents schema version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    if !table_exists(database, "django_migrations").await? {
        return Err(incompatible(
            "Documents adoption requires Django migration history",
        ));
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app='documents' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(storage)?;
    let migrations = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<Vec<_>, _>>()?;
    if migrations != schema::DJANGO_MIGRATIONS {
        return Err(incompatible(
            "unknown Documents migration history; no named bridge matches",
        ));
    }
    Ok(SourceClassification::Django(schema::CURRENT_DJANGO_LEAF))
}

async fn validate_manifest(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), DocumentsPersistenceError> {
    let mut expected = DJANGO_COLUMNS
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<BTreeSet<_>>();
    if source == SourceClassification::RustOwned {
        expected.insert(ADOPTED_COLUMN.to_owned());
    }
    let observed = schema::columns(database, "design_documents").await?;
    if observed != expected {
        return Err(incompatible(format!(
            "unknown schema for design_documents: observed {observed:?}"
        )));
    }
    if !unique_path_constraint(database).await? {
        return Err(incompatible(
            "design_documents is missing its unique (root_dir, rel_path) constraint",
        ));
    }
    Ok(())
}

/// Reject a registry that could not have been produced by the semantics this
/// slice preserves. Each check is expressed against the rows themselves, so a
/// database that passes has nothing left for adoption to guess about.
async fn validate_semantics(
    database: &impl ConnectionTrait,
) -> Result<(), DocumentsPersistenceError> {
    let scopes = DOCUMENT_SCOPES
        .iter()
        .map(|scope| format!("'{scope}'"))
        .collect::<Vec<_>>()
        .join(",");
    let checks = [
        (
            "Design Document required values".to_owned(),
            "SELECT COUNT(*) AS count FROM design_documents WHERE id='' OR task_id='' OR root_dir='' OR rel_path='' OR scope='' OR created_at='' OR updated_at=''".to_owned(),
        ),
        (
            "Design Document scope".to_owned(),
            format!("SELECT COUNT(*) AS count FROM design_documents WHERE scope NOT IN ({scopes})"),
        ),
        (
            "Design Document authorized root".to_owned(),
            "SELECT COUNT(*) AS count FROM design_documents WHERE root_dir NOT LIKE '/%'".to_owned(),
        ),
        (
            "Design Document relative path".to_owned(),
            "SELECT COUNT(*) AS count FROM design_documents WHERE rel_path LIKE '/%' OR rel_path='..' OR rel_path LIKE '../%' OR rel_path LIKE '%/../%' OR rel_path LIKE '%/..'".to_owned(),
        ),
        (
            "Design Document path identity".to_owned(),
            "SELECT COUNT(*) AS count FROM (SELECT root_dir, rel_path FROM design_documents GROUP BY root_dir, rel_path HAVING COUNT(*) > 1)".to_owned(),
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
    if schema::columns(database, "design_documents")
        .await?
        .contains(ADOPTED_COLUMN)
    {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM design_documents WHERE content_digest IS NOT NULL AND (length(content_digest) <> 64 OR content_digest GLOB '*[^0-9a-f]*')".to_owned(),
            ))
            .await
            .map_err(storage)?
            .expect("count query returns a row");
        if row.try_get::<i64>("", "count").map_err(storage)? != 0 {
            return Err(invalid(
                "semantically invalid Design Document content digest",
            ));
        }
    }
    Ok(())
}

/// Digest exactly the columns adoption promises to preserve. `content_digest`
/// is deliberately excluded: it is the column this slice adds, so including it
/// would make the pre/post comparison unable to detect anything else.
async fn stable_digest(
    database: &impl ConnectionTrait,
) -> Result<String, DocumentsPersistenceError> {
    let mut hasher = Sha256::new();
    let expression = DJANGO_COLUMNS
        .iter()
        .map(|column| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(",");
    let query =
        format!("SELECT json_array({expression}) AS row_data FROM design_documents ORDER BY id");
    hasher.update(b"design_documents");
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

async fn verify_snapshot(
    path: &Path,
    source: SourceClassification,
    expected_digest: &str,
) -> Result<(), DocumentsPersistenceError> {
    let database = connect(path, true).await?;
    integrity(&database).await?;
    if classify(&database).await? != source {
        return Err(incompatible("Documents snapshot classification changed"));
    }
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let digest = stable_digest(&database).await?;
    database.close().await.map_err(storage)?;
    if digest != expected_digest {
        return Err(invalid("Documents snapshot changed registered rows"));
    }
    Ok(())
}

async fn integrity(database: &impl ConnectionTrait) -> Result<(), DocumentsPersistenceError> {
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
    let foreign_keys = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .map_err(storage)?;
    if !foreign_keys.is_empty() {
        return Err(invalid("Documents database has foreign-key violations"));
    }
    Ok(())
}

/// Whether the Design Document registry has been adopted in this database.
/// Compositions that predate adoption still serve every other capability.
pub async fn documents_adopted(database: &impl ConnectionTrait) -> bool {
    table_exists(database, schema::LEDGER_TABLE)
        .await
        .unwrap_or(false)
}

async fn registered_rows(
    database: &impl ConnectionTrait,
) -> Result<u64, DocumentsPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM design_documents".to_owned(),
        ))
        .await
        .map_err(storage)?
        .expect("count query returns a row");
    Ok(row.try_get::<i64>("", "count").map_err(storage)? as u64)
}

async fn unique_path_constraint(
    database: &impl ConnectionTrait,
) -> Result<bool, DocumentsPersistenceError> {
    let indexes = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA index_list('design_documents')".to_owned(),
        ))
        .await
        .map_err(storage)?;
    for index in indexes {
        if index.try_get::<i32>("", "unique").map_err(storage)? != 1 {
            continue;
        }
        let name = index.try_get::<String>("", "name").map_err(storage)?;
        let covered = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA index_info('{name}')"),
            ))
            .await
            .map_err(storage)?
            .into_iter()
            .map(|row| row.try_get::<String>("", "name").map_err(storage))
            .collect::<Result<BTreeSet<_>, _>>()?;
        if covered == BTreeSet::from(["rel_path".to_owned(), "root_dir".to_owned()]) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, DocumentsPersistenceError> {
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

fn checked_database_path(data_directory: &Path) -> Result<PathBuf, DocumentsPersistenceError> {
    let path = data_directory.join("state.db");
    if !path.is_file() {
        return Err(unavailable(
            "Documents adoption requires an existing SQLite state.db",
        ));
    }
    for checked in [data_directory, path.as_path()] {
        if fs::symlink_metadata(checked)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(unavailable("Documents adoption refuses symlinked storage"));
        }
    }
    Ok(path)
}

async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, DocumentsPersistenceError> {
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

fn rotate_snapshot(
    directory: &Path,
    database: &Path,
) -> Result<PathBuf, DocumentsPersistenceError> {
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let older = directory.join(format!("state.db.pre-rust-documents.{generation}"));
        let newer = directory.join(format!("state.db.pre-rust-documents.{}", generation + 1));
        if older.exists() {
            fs::rename(&older, &newer).map_err(io_error)?;
        }
    }
    let path = directory.join("state.db.pre-rust-documents.1");
    fs::copy(database, &path).map_err(io_error)?;
    Ok(path)
}

fn file_sha256(path: &Path) -> Result<String, DocumentsPersistenceError> {
    let bytes = fs::read(path).map_err(io_error)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn write_evidence(
    directory: &Path,
    evidence: &AdoptionEvidence,
) -> Result<(), DocumentsPersistenceError> {
    let destination = directory.join("documents-adoption.json");
    let temporary = directory.join(format!(".documents-adoption.{}.tmp", uuid::Uuid::new_v4()));
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

fn storage(source: sea_orm::DbErr) -> DocumentsPersistenceError {
    DocumentsPersistenceError::storage("Documents adoption storage operation failed", source)
}
fn io_error(source: std::io::Error) -> DocumentsPersistenceError {
    unavailable(format!(
        "Documents adoption file operation failed: {source}"
    ))
}
fn unavailable(message: impl Into<String>) -> DocumentsPersistenceError {
    DocumentsPersistenceError::new(DocumentsPersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> DocumentsPersistenceError {
    DocumentsPersistenceError::new(DocumentsPersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> DocumentsPersistenceError {
    DocumentsPersistenceError::new(DocumentsPersistenceErrorCode::InvalidRegistry, message)
}
