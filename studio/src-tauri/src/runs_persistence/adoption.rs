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

use super::schema::{self, AGENT_RUN_COLUMNS, ATTEMPT_BASE_COLUMNS, DJANGO_MIGRATIONS};
use super::{RunsPersistenceError, RunsPersistenceErrorCode};

const SNAPSHOT_GENERATIONS: usize = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DjangoGeneration {
    IssueScoped,
    LaunchRejection,
    RequiredSkillRetry,
    HistoricalFailuresDismissed,
    RunKindRemoved,
    Current,
    LegacyTerminalAuthority,
    Merged,
}

impl DjangoGeneration {
    fn number(self) -> usize {
        match self {
            Self::IssueScoped => 8,
            Self::LaunchRejection => 9,
            Self::RequiredSkillRetry => 10,
            Self::HistoricalFailuresDismissed => 11,
            Self::RunKindRemoved => 12,
            Self::Current => 13,
            Self::LegacyTerminalAuthority | Self::Merged => 15,
        }
    }

    fn leaf(self) -> &'static str {
        match self {
            Self::LegacyTerminalAuthority => schema::LEGACY_TERMINAL_DJANGO_LEAF,
            Self::Merged => schema::MERGED_DJANGO_LEAF,
            _ => DJANGO_MIGRATIONS[self.number() - 1],
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "owner", content = "generation")]
pub enum SourceClassification {
    Django(DjangoGeneration),
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
}

/// Read-only proof used before any schema or ownership mutation.
pub async fn preflight(
    data_directory: &Path,
) -> Result<SourceClassification, RunsPersistenceError> {
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
/// call this function until the final one-writer handoff ticket.
pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, RunsPersistenceError> {
    let path = checked_database_path(data_directory)?;
    let database = connect(&path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let digest_generation = digest_generation(&database, source).await?;
    let before = stable_digest(&database, digest_generation).await?;
    database.close().await.map_err(storage)?;

    if source == SourceClassification::RustOwned {
        return Ok(AdoptionEvidence {
            version: schema::VERSION,
            source,
            stable_digest: before,
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
    verify_snapshot(&snapshot_path, source, digest_generation, &before).await?;

    let writable = connect(&path, false).await?;
    writable
        .execute_unprepared("PRAGMA foreign_keys=OFF")
        .await
        .map_err(storage)?;
    let SourceClassification::Django(generation) = source else {
        unreachable!()
    };
    schema::install(&writable, Some(generation.leaf()), &before).await?;
    writable
        .execute_unprepared("PRAGMA foreign_keys=ON")
        .await
        .map_err(storage)?;
    integrity(&writable).await?;
    let installed = classify(&writable).await?;
    if installed != SourceClassification::RustOwned {
        return Err(incompatible("Runs ownership ledger was not installed"));
    }
    validate_manifest(&writable, installed).await?;
    validate_semantics(&writable).await?;
    let after = stable_digest(&writable, digest_generation).await?;
    writable.close().await.map_err(storage)?;
    if after != before {
        return Err(invalid(
            "Runs history changed while installing the persistence seam",
        ));
    }

    let evidence = AdoptionEvidence {
        version: schema::VERSION,
        source,
        stable_digest: before,
        snapshot_path: Some(snapshot_path),
        snapshot_sha256: Some(snapshot_sha256),
        restoration_verified: true,
    };
    write_evidence(data_directory, &evidence)?;
    Ok(evidence)
}

async fn classify(
    database: &impl ConnectionTrait,
) -> Result<SourceClassification, RunsPersistenceError> {
    if table_exists(database, "ticketry_runs_adoption").await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM ticketry_runs_adoption WHERE singleton=1".to_owned(),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| incompatible("Runs ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(storage)?;
        if version != schema::VERSION {
            return Err(incompatible(format!(
                "unknown Rust Runs schema version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    if !table_exists(database, "django_migrations").await? {
        return Err(incompatible(
            "Runs adoption requires Django migration history",
        ));
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app='runs' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(storage)?;
    let migrations = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<Vec<_>, _>>()?;
    let generation = match migrations.last().map(String::as_str) {
        Some("0008_agentrun_issue") => DjangoGeneration::IssueScoped,
        Some("0009_automationattempt_launch_rejection") => DjangoGeneration::LaunchRejection,
        Some("0010_make_required_skill_failures_retryable") => DjangoGeneration::RequiredSkillRetry,
        Some("0011_dismiss_historical_automation_failures") => {
            DjangoGeneration::HistoricalFailuresDismissed
        }
        Some("0012_remove_legacy_agentrun_run_kind") => DjangoGeneration::RunKindRemoved,
        Some(schema::CURRENT_DJANGO_LEAF) => DjangoGeneration::Current,
        Some(schema::LEGACY_TERMINAL_DJANGO_LEAF) => DjangoGeneration::LegacyTerminalAuthority,
        Some(schema::MERGED_DJANGO_LEAF) => DjangoGeneration::Merged,
        _ => {
            return Err(incompatible(
                "unknown Runs migration history; no named bridge matches",
            ))
        }
    };
    let expected = expected_migrations(generation);
    if migrations != expected {
        return Err(incompatible(
            "Runs migration history contains a gap or unknown migration",
        ));
    }
    Ok(SourceClassification::Django(generation))
}

async fn validate_manifest(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), RunsPersistenceError> {
    let agent = schema::columns(database, "agent_runs").await?;
    let mut expected_agent = AGENT_RUN_COLUMNS
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<BTreeSet<_>>();
    if matches!(source, SourceClassification::Django(generation) if generation.number() < 13 || generation == DjangoGeneration::LegacyTerminalAuthority)
    {
        expected_agent.remove("model");
        expected_agent.remove("reasoning");
    }
    if matches!(source, SourceClassification::Django(generation) if !matches!(generation, DjangoGeneration::LegacyTerminalAuthority | DjangoGeneration::Merged))
    {
        expected_agent.remove("launch_state");
        expected_agent.remove("launch_model");
    }
    if matches!(
        source,
        SourceClassification::Django(DjangoGeneration::LegacyTerminalAuthority)
    ) {
        expected_agent.insert("initial_prompt".to_owned());
    }
    if matches!(source, SourceClassification::Django(generation) if generation != DjangoGeneration::Current)
        && agent.contains("run_kind")
    {
        expected_agent.insert("run_kind".to_owned());
    }
    let rust_legacy_shape = source == SourceClassification::RustOwned
        && agent
            == AGENT_RUN_COLUMNS
                .iter()
                .map(|column| (*column).to_owned())
                .chain(["initial_prompt".to_owned()])
                .collect();
    if agent != expected_agent && !rust_legacy_shape {
        return Err(incompatible(format!(
            "unknown schema for agent_runs: observed {agent:?}"
        )));
    }
    let mut expected_attempt = ATTEMPT_BASE_COLUMNS
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<BTreeSet<_>>();
    let generation = digest_generation(database, source).await?;
    if source == SourceClassification::RustOwned || generation.number() >= 9 {
        expected_attempt.extend(["error_details".to_owned(), "retryable".to_owned()]);
    }
    if source == SourceClassification::RustOwned || generation.number() >= 11 {
        expected_attempt.insert("dismissed_at".to_owned());
    }
    let attempt = schema::columns(database, "automation_attempts").await?;
    if attempt != expected_attempt {
        return Err(incompatible(format!(
            "unknown schema for automation_attempts: observed {attempt:?}"
        )));
    }
    if source == SourceClassification::RustOwned {
        for table in &schema::AUTHORED_TABLES[2..] {
            if !table_exists(database, table).await? {
                return Err(incompatible(format!("Rust Runs schema is missing {table}")));
            }
        }
    }
    validate_adopted_column_shapes(database, source).await?;
    Ok(())
}

async fn validate_adopted_column_shapes(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), RunsPersistenceError> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info('agent_runs')".to_owned(),
        ))
        .await
        .map_err(storage)?;
    let facts = rows
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<String>("", "name").map_err(storage)?,
                (
                    row.try_get::<String>("", "type")
                        .map_err(storage)?
                        .to_ascii_lowercase(),
                    row.try_get::<i32>("", "notnull").map_err(storage)?,
                    row.try_get::<Option<String>>("", "dflt_value")
                        .map_err(storage)?,
                ),
            ))
        })
        .collect::<Result<BTreeMap<_, _>, RunsPersistenceError>>()?;
    for (column, data_type) in [
        ("agent", "varchar"),
        ("model", "varchar"),
        ("reasoning", "varchar"),
        ("scope", "varchar"),
        ("launch_state", "varchar"),
        ("launch_model", "varchar"),
    ] {
        let Some((observed_type, not_null, default)) = facts.get(column) else {
            continue;
        };
        let expected_not_null = if column == "scope" {
            1
        } else if column == "agent"
            && matches!(
                source,
                SourceClassification::Django(
                    DjangoGeneration::IssueScoped
                        | DjangoGeneration::LaunchRejection
                        | DjangoGeneration::RequiredSkillRetry
                        | DjangoGeneration::HistoricalFailuresDismissed
                        | DjangoGeneration::RunKindRemoved
                        | DjangoGeneration::Current
                )
            )
        {
            // The parallel optional-provider branch can already have widened
            // this column before its merge leaf exists. Both fingerprints are
            // safe because adoption only widens and never fills a provider.
            *not_null
        } else {
            0
        };
        if observed_type != data_type || *not_null != expected_not_null || default.is_some() {
            return Err(incompatible(format!(
                "unknown definition for agent_runs.{column}"
            )));
        }
    }
    Ok(())
}

async fn validate_semantics(database: &impl ConnectionTrait) -> Result<(), RunsPersistenceError> {
    let checks = [
        ("Agent Run required values", "SELECT COUNT(*) AS count FROM agent_runs WHERE id='' OR issue_id='' OR agent='' OR status='' OR started_at='' OR scope=''"),
        ("Agent Run issue scope", "SELECT COUNT(*) AS count FROM agent_runs r LEFT JOIN worktracker_issue i ON i.id=r.issue_id WHERE i.id IS NULL"),
        ("Automation Attempt status", "SELECT COUNT(*) AS count FROM automation_attempts WHERE status NOT IN ('pending','succeeded','failed')"),
        ("Automation Attempt issue scope", "SELECT COUNT(*) AS count FROM automation_attempts a LEFT JOIN worktracker_issue i ON i.id=a.issue_id WHERE i.id IS NULL"),
        ("Automation Attempt retry lineage", "SELECT COUNT(*) AS count FROM automation_attempts WHERE (retry_of_id IS NULL) <> (root_attempt_id IS NULL) OR retry_of_id=id OR root_attempt_id=id"),
    ];
    for (label, query) in checks {
        let row = database
            .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
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
    generation: DjangoGeneration,
) -> Result<String, RunsPersistenceError> {
    let mut hasher = Sha256::new();
    let mut agent_columns = AGENT_RUN_COLUMNS.to_vec();
    if !matches!(
        generation,
        DjangoGeneration::LegacyTerminalAuthority | DjangoGeneration::Merged
    ) {
        agent_columns.retain(|column| !matches!(*column, "launch_state" | "launch_model"));
    }
    if generation.number() < 13 || generation == DjangoGeneration::LegacyTerminalAuthority {
        agent_columns.retain(|column| !matches!(*column, "model" | "reasoning"));
    }
    if generation == DjangoGeneration::LegacyTerminalAuthority {
        agent_columns.push("initial_prompt");
    }
    digest_table(database, "agent_runs", &agent_columns, &mut hasher).await?;
    let mut attempt_columns = ATTEMPT_BASE_COLUMNS.to_vec();
    if generation.number() >= 9 {
        attempt_columns.extend(["error_details", "retryable"]);
    }
    if generation.number() >= 11 {
        attempt_columns.push("dismissed_at");
    }
    digest_table(
        database,
        "automation_attempts",
        &attempt_columns,
        &mut hasher,
    )
    .await?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn expected_migrations(generation: DjangoGeneration) -> Vec<String> {
    match generation {
        DjangoGeneration::LegacyTerminalAuthority => [
            &DJANGO_MIGRATIONS[..12],
            &[
                "0013_agentrun_optional_agent",
                "0014_agentrun_launch_metadata",
                schema::LEGACY_TERMINAL_DJANGO_LEAF,
            ],
        ]
        .concat()
        .into_iter()
        .map(str::to_owned)
        .collect(),
        DjangoGeneration::Merged => [
            &DJANGO_MIGRATIONS[..12],
            &[
                schema::CURRENT_DJANGO_LEAF,
                "0013_agentrun_optional_agent",
                "0014_agentrun_launch_metadata",
                schema::MERGED_DJANGO_LEAF,
            ],
        ]
        .concat()
        .into_iter()
        .map(str::to_owned)
        .collect(),
        _ => DJANGO_MIGRATIONS[..generation.number()]
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

async fn digest_generation(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<DjangoGeneration, RunsPersistenceError> {
    if let SourceClassification::Django(generation) = source {
        return Ok(generation);
    }
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT source_leaf FROM ticketry_runs_adoption WHERE singleton=1".to_owned(),
        ))
        .await
        .map_err(storage)?
        .ok_or_else(|| incompatible("Runs ownership ledger is incomplete"))?;
    let leaf = row.try_get::<String>("", "source_leaf").map_err(storage)?;
    match leaf.as_str() {
        "0008_agentrun_issue" => Ok(DjangoGeneration::IssueScoped),
        "0009_automationattempt_launch_rejection" => Ok(DjangoGeneration::LaunchRejection),
        "0010_make_required_skill_failures_retryable" => Ok(DjangoGeneration::RequiredSkillRetry),
        "0011_dismiss_historical_automation_failures" => {
            Ok(DjangoGeneration::HistoricalFailuresDismissed)
        }
        "0012_remove_legacy_agentrun_run_kind" => Ok(DjangoGeneration::RunKindRemoved),
        schema::CURRENT_DJANGO_LEAF => Ok(DjangoGeneration::Current),
        schema::LEGACY_TERMINAL_DJANGO_LEAF => Ok(DjangoGeneration::LegacyTerminalAuthority),
        schema::MERGED_DJANGO_LEAF => Ok(DjangoGeneration::Merged),
        _ => Err(incompatible(
            "Runs ownership ledger has an unknown source leaf",
        )),
    }
}

async fn digest_table(
    database: &impl ConnectionTrait,
    table: &str,
    columns: &[&str],
    hasher: &mut Sha256,
) -> Result<(), RunsPersistenceError> {
    let expression = columns
        .iter()
        .map(|column| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(",");
    let query = format!("SELECT json_array({expression}) AS row_data FROM {table} ORDER BY id");
    hasher.update(table.as_bytes());
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
    Ok(())
}

async fn verify_snapshot(
    path: &Path,
    source: SourceClassification,
    generation: DjangoGeneration,
    expected_digest: &str,
) -> Result<(), RunsPersistenceError> {
    let database = connect(path, true).await?;
    integrity(&database).await?;
    if classify(&database).await? != source {
        return Err(incompatible("Runs snapshot classification changed"));
    }
    validate_manifest(&database, source).await?;
    validate_semantics(&database).await?;
    let digest = stable_digest(&database, generation).await?;
    database.close().await.map_err(storage)?;
    if digest != expected_digest {
        return Err(invalid("Runs snapshot changed historical rows"));
    }
    Ok(())
}

async fn integrity(database: &impl ConnectionTrait) -> Result<(), RunsPersistenceError> {
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
        return Err(invalid("Runs database has foreign-key violations"));
    }
    Ok(())
}

/// Whether the durable status outbox has been adopted in this database.
///
/// A composition without it is a pre-adoption or probe schema: it still serves
/// every authored command, it simply publishes no durable fact. Callers use
/// this to decide whether to compose a fact recorder at all, rather than
/// discovering a missing table when a person's write is already in flight.
pub async fn outbox_adopted(database: &impl ConnectionTrait) -> bool {
    table_exists(database, "runs_status_events")
        .await
        .unwrap_or(false)
}

async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, RunsPersistenceError> {
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

fn checked_database_path(data_directory: &Path) -> Result<PathBuf, RunsPersistenceError> {
    let path = data_directory.join("state.db");
    if !path.is_file() {
        return Err(unavailable(
            "Runs adoption requires an existing SQLite state.db",
        ));
    }
    for checked in [data_directory, path.as_path()] {
        if fs::symlink_metadata(checked)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(unavailable("Runs adoption refuses symlinked storage"));
        }
    }
    Ok(path)
}

async fn connect(path: &Path, read_only: bool) -> Result<DatabaseConnection, RunsPersistenceError> {
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

fn rotate_snapshot(directory: &Path, database: &Path) -> Result<PathBuf, RunsPersistenceError> {
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let older = directory.join(format!("state.db.pre-rust-runs.{generation}"));
        let newer = directory.join(format!("state.db.pre-rust-runs.{}", generation + 1));
        if older.exists() {
            fs::rename(&older, &newer).map_err(io_error)?;
        }
    }
    let path = directory.join("state.db.pre-rust-runs.1");
    fs::copy(database, &path).map_err(io_error)?;
    Ok(path)
}

fn file_sha256(path: &Path) -> Result<String, RunsPersistenceError> {
    let bytes = fs::read(path).map_err(io_error)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn write_evidence(
    directory: &Path,
    evidence: &AdoptionEvidence,
) -> Result<(), RunsPersistenceError> {
    let destination = directory.join("runs-adoption.json");
    let temporary = directory.join(format!(".runs-adoption.{}.tmp", uuid::Uuid::new_v4()));
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

fn storage(source: sea_orm::DbErr) -> RunsPersistenceError {
    RunsPersistenceError::storage("Runs adoption storage operation failed", source)
}
fn io_error(source: std::io::Error) -> RunsPersistenceError {
    unavailable(format!("Runs adoption file operation failed: {source}"))
}
fn unavailable(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::AdoptionUnavailable, message)
}
fn incompatible(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::InvalidHistory, message)
}
