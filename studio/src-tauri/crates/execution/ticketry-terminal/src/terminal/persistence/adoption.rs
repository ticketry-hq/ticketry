use std::collections::{BTreeMap, BTreeSet};
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
    self, CLEANUP_EFFECT_COLUMNS, CURRENT_DJANGO_LEAF, EMPTY_DJANGO_LEAF, LAUNCH_MATERIAL_COLUMNS,
    LAUNCH_REQUEST_COLUMNS, LEASE_COLUMNS, LEDGER_TABLE, SESSION_COLUMNS,
};
use super::{TerminalPersistenceError, TerminalPersistenceErrorCode};
use crate::tmux_adapter::SESSION_PREFIX;

mod evidence;
mod schema_validation;
mod snapshot;

use evidence::{
    active_lease_count, integrity, row_count, schema_fingerprint, stable_digest, table_evidence,
    verify_snapshot, EMPTY_DIGEST,
};
use schema_validation::{expected_columns, validate_schema, validate_semantics};
use snapshot::{file_sha256, rotate_snapshot, write_evidence};

const SNAPSHOT_GENERATIONS: usize = 3;
const SCOPES: &[&str] = &["task", "plan", "instant", "docchat", "shell"];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "owner", content = "generation")]
pub enum SourceClassification {
    Django(&'static str),
    RustOwned,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TableEvidence {
    pub row_count: u64,
    pub stable_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub source_schema_fingerprint: String,
    pub tables: BTreeMap<String, TableEvidence>,
    pub snapshot_path: Option<PathBuf>,
    pub snapshot_sha256: Option<String>,
    pub stale_viewer_leases_expired: u64,
    pub restoration_verified: bool,
}

pub async fn preflight(
    data_directory: &Path,
) -> Result<SourceClassification, TerminalPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, false).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    // An already-owned store still gains the additive launch-material columns
    // this build reads. Nothing else about its history is touched.
    schema::reconcile_launch_material_columns(&database).await?;
    validate_schema(&database, source).await?;
    validate_semantics(&database, source).await?;
    database.close().await.map_err(storage)?;
    Ok(source)
}

/// Validate and adopt for startup without hashing unchanged history on reopen.
pub async fn ensure_adopted(data_directory: &Path) -> Result<(), TerminalPersistenceError> {
    adopt_inner(data_directory, false).await.map(drop)
}

pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, TerminalPersistenceError> {
    Ok(adopt_inner(data_directory, true)
        .await?
        .expect("adoption evidence requested"))
}

async fn adopt_inner(
    data_directory: &Path,
    capture_evidence: bool,
) -> Result<Option<AdoptionEvidence>, TerminalPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, false).await?;
    // Installation preflight already ran integrity_check on this file this startup.
    if capture_evidence {
        integrity(&database).await?;
    }
    let source = classify(&database).await?;
    // An already-owned store still gains the additive launch-material columns
    // this build reads. Nothing else about its history is touched.
    schema::reconcile_launch_material_columns(&database).await?;
    validate_schema(&database, source).await?;
    validate_semantics(&database, source).await?;
    // Reopening retains validation, but needs no migration digest.
    if !capture_evidence && source == SourceClassification::RustOwned {
        database.close().await.map_err(storage)?;
        return Ok(None);
    }
    let fingerprint = schema_fingerprint(&database).await?;
    let before = table_evidence(&database, source).await?;
    let leases_to_expire = active_lease_count(&database).await?;
    database.close().await.map_err(storage)?;

    if source == SourceClassification::RustOwned {
        return Ok(Some(AdoptionEvidence {
            version: schema::VERSION,
            source,
            source_schema_fingerprint: fingerprint,
            tables: before,
            snapshot_path: None,
            snapshot_sha256: None,
            stale_viewer_leases_expired: 0,
            restoration_verified: true,
        }));
    }

    let checkpoint = connect(&path, false).await?;
    checkpoint
        .execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE)")
        .await
        .map_err(storage)?;
    checkpoint.close().await.map_err(storage)?;
    let snapshot_path = rotate_snapshot(data_directory, &path)?;
    let snapshot_sha256 = file_sha256(&snapshot_path)?;
    verify_snapshot(&snapshot_path, source, &fingerprint, &before).await?;

    let SourceClassification::Django(leaf) = source else {
        unreachable!()
    };
    let session_digest = before
        .get("agent_terminal_sessions")
        .map(|e| e.stable_digest.as_str())
        .unwrap_or(EMPTY_DIGEST);
    let launch_digest = before
        .get("terminal_launch_requests")
        .map(|e| e.stable_digest.as_str())
        .unwrap_or(EMPTY_DIGEST);
    let source_columns = expected_columns(source);
    let preservation_checks = ["agent_terminal_sessions", "terminal_launch_requests"]
        .into_iter()
        .filter_map(|table| {
            before.get(table).map(|evidence| schema::PreservationCheck {
                table,
                columns: source_columns[table],
                row_count: evidence.row_count,
                stable_digest: &evidence.stable_digest,
            })
        })
        .collect::<Vec<_>>();
    let writable = connect(&path, false).await?;
    schema::install(
        &writable,
        leaf,
        &fingerprint,
        session_digest,
        launch_digest,
        &preservation_checks,
    )
    .await?;
    writable.close().await.map_err(storage)?;

    let reopened = connect(&path, true).await?;
    integrity(&reopened).await?;
    if classify(&reopened).await? != SourceClassification::RustOwned {
        return Err(incompatible("Terminal ownership ledger was not installed"));
    }
    validate_schema(&reopened, SourceClassification::RustOwned).await?;
    validate_semantics(&reopened, SourceClassification::RustOwned).await?;
    let after = table_evidence(&reopened, SourceClassification::RustOwned).await?;

    for table in ["agent_terminal_sessions", "terminal_launch_requests"] {
        if let Some(before_table) = before.get(table) {
            let after_count = row_count(&reopened, table).await?;
            let after_digest = stable_digest(&reopened, table, source_columns[table]).await?;
            if before_table.row_count != after_count || before_table.stable_digest != after_digest {
                return Err(invalid(format!(
                    "{table} history changed during Terminal adoption"
                )));
            }
        }
    }
    if after["terminal_launch_material"].row_count != 0
        || after["terminal_cleanup_effects"].row_count != 0
    {
        return Err(invalid(
            "Imported launch or cleanup history became executable intent",
        ));
    }
    reopened.close().await.map_err(storage)?;

    let evidence = AdoptionEvidence {
        version: schema::VERSION,
        source,
        source_schema_fingerprint: fingerprint,
        tables: after,
        snapshot_path: Some(snapshot_path),
        snapshot_sha256: Some(snapshot_sha256),
        stale_viewer_leases_expired: leases_to_expire,
        restoration_verified: true,
    };
    write_evidence(data_directory, &evidence)?;
    Ok(Some(evidence))
}

async fn classify(
    database: &impl ConnectionTrait,
) -> Result<SourceClassification, TerminalPersistenceError> {
    if table_exists(database, LEDGER_TABLE).await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT version FROM {LEDGER_TABLE} WHERE singleton=1"),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| incompatible("Terminal ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(storage)?;
        if version != schema::VERSION {
            return Err(incompatible(format!(
                "unknown Rust Terminal schema version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    if !table_exists(database, "django_migrations").await? {
        return Err(incompatible(
            "Terminal adoption requires Django migration history",
        ));
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app='terminals' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(storage)?;
    let names = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let leaf = supported_leaf(&names).ok_or_else(|| {
        incompatible("unknown Terminal migration history; no named bridge matches")
    })?;
    Ok(SourceClassification::Django(leaf))
}

fn supported_leaf(names: &BTreeSet<String>) -> Option<&'static str> {
    if names.is_empty() {
        return Some(EMPTY_DJANGO_LEAF);
    }
    const LEAVES: &[(&str, &[&str])] = &[
        ("0001_initial", &["0001_initial"]),
        (
            "0002_agent_run_viewer_lease",
            &["0001_initial", "0002_agent_run_viewer_lease"],
        ),
        (
            "0003_agentterminalsession_runtime_cleanup_pending",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
            ],
        ),
        (
            "0004_agentterminalsession_runtime_namespace",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
            ],
        ),
        (
            "0005_terminal_output_activity",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
            ],
        ),
        (
            "0005_terminallaunchrequest",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminallaunchrequest",
            ],
        ),
        (
            "0006_terminal_session_optional_agent",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
                "0006_terminal_session_optional_agent",
            ],
        ),
        (
            "0007_restore_agent_run_fk_cascade",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
                "0006_terminal_session_optional_agent",
                "0007_restore_agent_run_fk_cascade",
            ],
        ),
        (
            "0008_merge_20260819_1521",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
                "0005_terminallaunchrequest",
                "0006_terminal_session_optional_agent",
                "0007_restore_agent_run_fk_cascade",
                "0008_merge_20260819_1521",
            ],
        ),
        (
            "0008_rename_terminal_task_index",
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
                "0006_terminal_session_optional_agent",
                "0007_restore_agent_run_fk_cascade",
                "0008_rename_terminal_task_index",
            ],
        ),
        (
            CURRENT_DJANGO_LEAF,
            &[
                "0001_initial",
                "0002_agent_run_viewer_lease",
                "0003_agentterminalsession_runtime_cleanup_pending",
                "0004_agentterminalsession_runtime_namespace",
                "0005_terminal_output_activity",
                "0005_terminallaunchrequest",
                "0006_terminal_session_optional_agent",
                "0007_restore_agent_run_fk_cascade",
                "0008_merge_20260819_1521",
                CURRENT_DJANGO_LEAF,
            ],
        ),
    ];
    LEAVES
        .iter()
        .find(|(_, expected)| {
            expected
                .iter()
                .map(|v| (*v).to_owned())
                .collect::<BTreeSet<_>>()
                == *names
        })
        .map(|(leaf, _)| *leaf)
}

pub async fn terminals_adopted(database: &impl ConnectionTrait) -> bool {
    table_exists(database, LEDGER_TABLE).await.unwrap_or(false)
}

async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, TerminalPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .map_err(storage)?
        .unwrap();
    Ok(row.try_get::<i64>("", "count").map_err(storage)? == 1)
}

fn checked_database_path(data_directory: &Path) -> Result<PathBuf, TerminalPersistenceError> {
    let path = data_directory.join("state.db");
    if !path.is_file() {
        return Err(unavailable(
            "Terminal adoption requires an existing SQLite state.db",
        ));
    }
    for checked in [data_directory, path.as_path()] {
        if fs::symlink_metadata(checked)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(unavailable("Terminal adoption refuses symlinked storage"));
        }
    }
    Ok(path)
}

async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, TerminalPersistenceError> {
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

fn storage(source: sea_orm::DbErr) -> TerminalPersistenceError {
    TerminalPersistenceError::storage("Terminal adoption storage operation failed", source)
}
fn io_error(source: std::io::Error) -> TerminalPersistenceError {
    unavailable(format!("Terminal adoption file operation failed: {source}"))
}
fn unavailable(message: impl Into<String>) -> TerminalPersistenceError {
    TerminalPersistenceError::new(TerminalPersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> TerminalPersistenceError {
    TerminalPersistenceError::new(TerminalPersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> TerminalPersistenceError {
    TerminalPersistenceError::new(TerminalPersistenceErrorCode::InvalidMetadata, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_supported_leaf_has_an_exact_history() {
        for leaf in [
            "0001_initial",
            "0002_agent_run_viewer_lease",
            "0003_agentterminalsession_runtime_cleanup_pending",
            "0004_agentterminalsession_runtime_namespace",
            "0005_terminal_output_activity",
            "0005_terminallaunchrequest",
            "0006_terminal_session_optional_agent",
            "0007_restore_agent_run_fk_cascade",
            "0008_merge_20260819_1521",
            CURRENT_DJANGO_LEAF,
        ] {
            assert!(
                supported_leaf(&expected_history(leaf)).is_some(),
                "missing {leaf}"
            );
        }
    }
    fn expected_history(leaf: &str) -> BTreeSet<String> {
        let mut values = BTreeSet::new();
        for name in [
            "0001_initial",
            "0002_agent_run_viewer_lease",
            "0003_agentterminalsession_runtime_cleanup_pending",
            "0004_agentterminalsession_runtime_namespace",
        ] {
            values.insert(name.to_owned());
            if name == leaf {
                return values;
            }
        }
        match leaf {
            "0005_terminal_output_activity" => {
                values.insert(leaf.to_owned());
                return values;
            }
            "0005_terminallaunchrequest" => {
                values.insert(leaf.to_owned());
                return values;
            }
            _ => {}
        }
        values.insert("0005_terminal_output_activity".to_owned());
        for name in [
            "0006_terminal_session_optional_agent",
            "0007_restore_agent_run_fk_cascade",
        ] {
            values.insert(name.to_owned());
            if name == leaf {
                return values;
            }
        }
        values.insert("0005_terminallaunchrequest".to_owned());
        values.insert("0008_merge_20260819_1521".to_owned());
        if leaf == "0008_merge_20260819_1521" {
            return values;
        }
        values.insert(CURRENT_DJANGO_LEAF.to_owned());
        values
    }
}
