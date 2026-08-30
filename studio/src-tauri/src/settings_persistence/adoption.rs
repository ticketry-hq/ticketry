use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
    TransactionTrait,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::atomic_json::{write_json, RealAtomicFileOperations};
use super::ownership_manifest::{OWNED_ASSETS, OWNED_TABLES, PROVIDER_ADAPTER_SLUGS, VERSION};
use super::SettingsPersistenceError;

const SNAPSHOT_GENERATIONS: usize = 3;
const DJANGO_MIGRATIONS: [&str; 2] = ["0001_initial", "0002_migrate_profile_prompt_authority"];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceClassification {
    DjangoCurrent,
    RustOwned,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum JsonSourceClassification {
    Missing,
    Valid,
    Malformed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdoptionEvidence {
    pub version: i32,
    pub source: SourceClassification,
    pub settings_digest: String,
    pub profiles_source: JsonSourceClassification,
    pub features_source: JsonSourceClassification,
    pub database_snapshot: Option<PathBuf>,
    pub profiles_snapshot: Option<PathBuf>,
    pub features_snapshot: Option<PathBuf>,
    pub row_counts: BTreeMap<String, u64>,
    pub profiles_digest: Option<String>,
    pub features_digest: Option<String>,
    pub database_snapshot_sha256: Option<String>,
    pub profiles_snapshot_sha256: Option<String>,
    pub features_snapshot_sha256: Option<String>,
    pub restoration_verified: bool,
}

/// Read-only classification used before any Slice 2 ownership ledger is
/// installed. The desktop holds the installation lease across this preflight
/// and the subsequent adoption.
pub async fn preflight(data_directory: &Path) -> Result<(), SettingsPersistenceError> {
    let database_path = data_directory.join("state.db");
    if !database_path.is_file() {
        return Err(unknown("settings adoption requires an existing state.db"));
    }
    reject_symlink(data_directory)?;
    reject_symlink(&database_path)?;
    let database = connect(&database_path, true).await?;
    integrity(&database).await?;
    classify(&database).await?;
    validate_manifest(&database).await?;
    validate_semantics(&database).await?;
    settings_digest(&database).await?;
    row_counts(&database).await?;
    database.close().await?;
    classify_local_file(
        &data_directory.join(OWNED_ASSETS[0]),
        super::legacy_profile_files::validate_profile_file,
    )?;
    classify_local_file(
        &data_directory.join(OWNED_ASSETS[1]),
        super::legacy_profile_files::validate_feature_file,
    )?;
    Ok(())
}

/// Classify and adopt only an explicitly isolated/copied settings store.
pub async fn adopt(data_directory: &Path) -> Result<AdoptionEvidence, SettingsPersistenceError> {
    let database_path = data_directory.join("state.db");
    if !database_path.is_file() {
        return Err(unknown("settings adoption requires an existing state.db"));
    }
    reject_symlink(data_directory)?;
    reject_symlink(&database_path)?;

    let database = connect(&database_path, true).await?;
    integrity(&database).await?;
    let source = classify(&database).await?;
    validate_manifest(&database).await?;
    validate_semantics(&database).await?;
    let digest = settings_digest(&database).await?;
    let observed_row_counts = row_counts(&database).await?;
    let profiles_source = classify_local_file(
        &data_directory.join(OWNED_ASSETS[0]),
        super::legacy_profile_files::validate_profile_file,
    )?;
    let features_source = classify_local_file(
        &data_directory.join(OWNED_ASSETS[1]),
        super::legacy_profile_files::validate_feature_file,
    )?;
    let profiles_digest = digest_optional(&data_directory.join(OWNED_ASSETS[0]))?;
    let features_digest = digest_optional(&data_directory.join(OWNED_ASSETS[1]))?;
    if source == SourceClassification::RustOwned {
        database.close().await?;
        return Ok(AdoptionEvidence {
            version: VERSION,
            source,
            settings_digest: digest,
            profiles_source,
            features_source,
            database_snapshot: None,
            profiles_snapshot: None,
            features_snapshot: None,
            row_counts: observed_row_counts,
            profiles_digest,
            features_digest,
            database_snapshot_sha256: None,
            profiles_snapshot_sha256: None,
            features_snapshot_sha256: None,
            restoration_verified: true,
        });
    }

    database.close().await?;
    let checkpoint = connect(&database_path, false).await?;
    checkpoint
        .execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE)")
        .await?;
    checkpoint.close().await?;
    let database_snapshot = snapshot(&database_path, "state.db.pre-rust-settings")?;
    let profiles_snapshot = snapshot_optional(data_directory, "profiles.json")?;
    let features_snapshot = snapshot_optional(data_directory, "features.json")?;
    let database_snapshot_sha256 = file_sha256(&database_snapshot)?;
    let profiles_snapshot_sha256 = profiles_snapshot.as_deref().map(file_sha256).transpose()?;
    let features_snapshot_sha256 = features_snapshot.as_deref().map(file_sha256).transpose()?;
    let snapshot_database = connect(&database_snapshot, true).await?;
    integrity(&snapshot_database).await?;
    validate_manifest(&snapshot_database).await?;
    validate_semantics(&snapshot_database).await?;
    if settings_digest(&snapshot_database).await? != digest {
        return Err(unknown("settings snapshot changed existing rows"));
    }
    if row_counts(&snapshot_database).await? != observed_row_counts {
        return Err(unknown("settings snapshot changed transferred row counts"));
    }
    snapshot_database.close().await?;
    verify_asset_snapshot(
        profiles_snapshot.as_deref(),
        profiles_digest.as_deref(),
        super::legacy_profile_files::validate_profile_file,
    )?;
    verify_asset_snapshot(
        features_snapshot.as_deref(),
        features_digest.as_deref(),
        super::legacy_profile_files::validate_feature_file,
    )?;

    let writable = connect(&database_path, false).await?;
    let transaction = writable.begin().await?;
    transaction
        .execute_unprepared(
            "CREATE TABLE ticketry_settings_adoption (singleton integer PRIMARY KEY CHECK (singleton = 1), version integer NOT NULL, settings_digest char(64) NOT NULL, adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        )
        .await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO ticketry_settings_adoption (singleton, version, settings_digest) VALUES (1, ?, ?)",
            [VERSION.into(), digest.clone().into()],
        ))
        .await?;
    if settings_digest(&transaction).await? != digest {
        return Err(unknown("settings rows changed during adoption"));
    }
    if row_counts(&transaction).await? != observed_row_counts {
        return Err(unknown("transferred row counts changed during adoption"));
    }
    transaction.commit().await?;
    writable.close().await?;

    let evidence = AdoptionEvidence {
        version: VERSION,
        source,
        settings_digest: digest,
        profiles_source,
        features_source,
        database_snapshot: Some(database_snapshot),
        profiles_snapshot,
        features_snapshot,
        row_counts: observed_row_counts,
        profiles_digest,
        features_digest,
        database_snapshot_sha256: Some(database_snapshot_sha256),
        profiles_snapshot_sha256,
        features_snapshot_sha256,
        restoration_verified: true,
    };
    write_json(
        &data_directory.join("settings-cutover.json"),
        &evidence,
        &RealAtomicFileOperations,
    )?;
    Ok(evidence)
}

async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<DatabaseConnection, SettingsPersistenceError> {
    let database_path = path.to_owned();
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
                .filename(database_path.clone())
                .create_if_missing(false)
                .read_only(read_only)
                .busy_timeout(Duration::from_secs(5))
                .pragma("foreign_keys", "ON")
        });
    Ok(Database::connect(options).await?)
}

async fn classify(
    database: &DatabaseConnection,
) -> Result<SourceClassification, SettingsPersistenceError> {
    if table_exists(database, "ticketry_settings_adoption").await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM ticketry_settings_adoption WHERE singleton = 1".to_owned(),
            ))
            .await?
            .ok_or_else(|| unknown("settings adoption ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version")?;
        if version != VERSION {
            return Err(unknown(format!("unknown Rust settings version {version}")));
        }
        return Ok(SourceClassification::RustOwned);
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app = 'settings_store' ORDER BY name"
                .to_owned(),
        ))
        .await?;
    let actual = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "name"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let expected = DJANGO_MIGRATIONS.into_iter().map(str::to_owned).collect();
    if actual != expected {
        return Err(unknown(format!(
            "unknown settings migration generation: {actual:?}"
        )));
    }
    Ok(SourceClassification::DjangoCurrent)
}

async fn validate_manifest(
    database: &impl ConnectionTrait,
) -> Result<(), SettingsPersistenceError> {
    for (table, columns) in effective_owned_tables(database).await? {
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await?;
        let actual = rows
            .into_iter()
            .map(|row| row.try_get::<String>("", "name"))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let expected = columns.iter().map(|column| (*column).to_owned()).collect();
        if actual != expected {
            return Err(unknown(format!(
                "unknown transferred schema for {table}: {actual:?}"
            )));
        }
    }
    Ok(())
}

async fn validate_semantics(
    database: &impl ConnectionTrait,
) -> Result<(), SettingsPersistenceError> {
    let checks = [
        (
            "empty settings identities or timestamps",
            "SELECT COUNT(*) AS count FROM app_settings WHERE scope = '' OR \"key\" = '' OR updated_at = ''",
        ),
        (
            "invalid settings JSON",
            "SELECT COUNT(*) AS count FROM app_settings WHERE json_valid(value) = 0",
        ),
        (
            "empty provider identities",
            "SELECT COUNT(*) AS count FROM worktracker_provider WHERE id = '' OR slug = ''",
        ),
        (
            "empty model identities",
            "SELECT COUNT(*) AS count FROM worktracker_agentmodel WHERE id = '' OR name = ''",
        ),
        (
            "empty reasoning identities",
            "SELECT COUNT(*) AS count FROM worktracker_reasoninglevel WHERE id = '' OR name = ''",
        ),
        (
            "launch bindings with reasoning but no model",
            "SELECT COUNT(*) AS count FROM worktracker_launchbinding WHERE reasoning_id IS NOT NULL AND model_id IS NULL",
        ),
        (
            "incompatible launch-binding reasoning",
            concat!(
                "SELECT COUNT(*) AS count FROM worktracker_launchbinding binding ",
                "WHERE binding.reasoning_id IS NOT NULL AND NOT EXISTS (",
                "SELECT 1 FROM worktracker_agentmodelreasoninglevel compatibility ",
                "WHERE compatibility.agent_model_id = binding.model_id ",
                "AND compatibility.reasoning_level_id = binding.reasoning_id)"
            ),
        ),
        (
            "cross-project launch bindings",
            concat!(
                "SELECT COUNT(*) AS count FROM worktracker_launchbinding binding ",
                "JOIN worktracker_issuetype kind ON kind.id = binding.issue_type_id ",
                "JOIN worktracker_state state ON state.id = binding.state_id ",
                "WHERE kind.project_id <> state.project_id"
            ),
        ),
    ];
    for (label, query) in checks {
        let row = database
            .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
            .await?
            .ok_or_else(|| unknown(format!("semantic check returned no row: {label}")))?;
        let count = row.try_get::<i64>("", "count")?;
        if count != 0 {
            return Err(unknown(format!(
                "settings preflight rejected {count} {label}"
            )));
        }
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT slug FROM worktracker_provider ORDER BY slug".to_owned(),
        ))
        .await?;
    let actual = rows
        .into_iter()
        .map(|row| row.try_get::<String>("", "slug"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let expected = PROVIDER_ADAPTER_SLUGS
        .iter()
        .map(|slug| (*slug).to_owned())
        .collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(unknown(format!(
            "provider catalogue does not match shipping adapters: expected {expected:?}, observed {actual:?}"
        )));
    }
    Ok(())
}

async fn settings_digest(
    database: &impl ConnectionTrait,
) -> Result<String, SettingsPersistenceError> {
    let mut hasher = Sha256::new();
    for (table, columns) in effective_owned_tables(database).await? {
        hasher.update(table.as_bytes());
        let projection = columns
            .iter()
            .map(|column| format!("COALESCE(quote(\"{column}\"), 'NULL')"))
            .collect::<Vec<_>>()
            .join(" || '|' || ");
        let order = if columns.contains(&"id") {
            "id"
        } else {
            columns[0]
        };
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT {projection} AS stable_row FROM {table} ORDER BY \"{order}\""),
            ))
            .await?;
        for row in rows {
            let value = row.try_get::<String>("", "stable_row")?;
            hasher.update((value.len() as u64).to_be_bytes());
            hasher.update(value.as_bytes());
        }
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

/// The settings handoff precedes the final Work Management migration chain on
/// first launch. On every later launch, that chain's ledger is the durable
/// proof that LaunchBinding.entry_skill is part of the owned schema.
async fn effective_owned_tables(
    database: &impl ConnectionTrait,
) -> Result<Vec<(&'static str, Vec<&'static str>)>, SettingsPersistenceError> {
    let entry_skill_installed = table_exists(
        database,
        crate::work_management::launch_binding_entry_skill_migration::LEDGER_TABLE,
    )
    .await?;
    Ok(OWNED_TABLES
        .iter()
        .map(|(table, columns)| {
            let mut columns = columns.to_vec();
            if *table == "worktracker_launchbinding" && entry_skill_installed {
                columns.push("entry_skill");
            }
            (*table, columns)
        })
        .collect())
}

async fn row_counts(
    database: &impl ConnectionTrait,
) -> Result<BTreeMap<String, u64>, SettingsPersistenceError> {
    let mut counts = BTreeMap::new();
    for (table, _) in OWNED_TABLES {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT COUNT(*) AS count FROM {table}"),
            ))
            .await?
            .ok_or_else(|| unknown(format!("row-count check returned no row for {table}")))?;
        let count = row.try_get::<i64>("", "count")?;
        counts.insert(
            (*table).to_owned(),
            u64::try_from(count).unwrap_or_default(),
        );
    }
    Ok(counts)
}

async fn integrity(database: &DatabaseConnection) -> Result<(), SettingsPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await?
        .ok_or_else(|| unknown("SQLite integrity check returned no result"))?;
    if row.try_get::<String>("", "integrity_check")? != "ok" {
        return Err(unknown("SQLite integrity check failed"));
    }
    Ok(())
}

fn classify_local_file(
    path: &Path,
    validate: fn(&Path) -> Result<(), SettingsPersistenceError>,
) -> Result<JsonSourceClassification, SettingsPersistenceError> {
    if !path.exists() {
        return Ok(JsonSourceClassification::Missing);
    }
    reject_symlink(path)?;
    validate(path)?;
    Ok(JsonSourceClassification::Valid)
}

fn digest_optional(path: &Path) -> Result<Option<String>, SettingsPersistenceError> {
    path.is_file().then(|| file_sha256(path)).transpose()
}

fn verify_asset_snapshot(
    snapshot: Option<&Path>,
    expected_digest: Option<&str>,
    validate: fn(&Path) -> Result<(), SettingsPersistenceError>,
) -> Result<(), SettingsPersistenceError> {
    match (snapshot, expected_digest) {
        (None, None) => Ok(()),
        (Some(snapshot), Some(expected)) => {
            validate(snapshot)?;
            if file_sha256(snapshot)? != expected {
                return Err(unknown(format!(
                    "settings asset snapshot digest changed {}",
                    snapshot.display()
                )));
            }
            Ok(())
        }
        _ => Err(unknown("settings asset snapshot set is incomplete")),
    }
}

fn snapshot(source: &Path, name: &str) -> Result<PathBuf, SettingsPersistenceError> {
    let directory = source
        .parent()
        .ok_or_else(|| unknown("snapshot source has no parent"))?;
    let destination = directory.join(format!("{name}.1"));
    let temporary = directory.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    copy_private(source, &temporary)?;
    for generation in (1..SNAPSHOT_GENERATIONS).rev() {
        let from = directory.join(format!("{name}.{generation}"));
        let to = directory.join(format!("{name}.{}", generation + 1));
        if from.exists() {
            fs::rename(&from, &to).map_err(|error| SettingsPersistenceError::io(&to, error))?;
        }
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| SettingsPersistenceError::io(&destination, error))?;
    Ok(destination)
}

fn snapshot_optional(
    data_directory: &Path,
    name: &str,
) -> Result<Option<PathBuf>, SettingsPersistenceError> {
    let source = data_directory.join(name);
    if !source.is_file() {
        return Ok(None);
    }
    snapshot(&source, &format!("{name}.pre-rust-settings")).map(Some)
}

fn copy_private(source: &Path, destination: &Path) -> Result<(), SettingsPersistenceError> {
    let mut input =
        File::open(source).map_err(|error| SettingsPersistenceError::io(source, error))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(destination)
        .map_err(|error| SettingsPersistenceError::io(destination, error))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| SettingsPersistenceError::io(source, error))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| SettingsPersistenceError::io(destination, error))?;
    }
    output
        .sync_all()
        .map_err(|error| SettingsPersistenceError::io(destination, error))
}

fn file_sha256(path: &Path) -> Result<String, SettingsPersistenceError> {
    let mut file = File::open(path).map_err(|error| SettingsPersistenceError::io(path, error))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| SettingsPersistenceError::io(path, error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn reject_symlink(path: &Path) -> Result<(), SettingsPersistenceError> {
    if fs::symlink_metadata(path)
        .map_err(|error| SettingsPersistenceError::io(path, error))?
        .file_type()
        .is_symlink()
    {
        return Err(unknown(format!(
            "settings adoption refuses symlink {}",
            path.display()
        )));
    }
    Ok(())
}

async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, SettingsPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await?
        .ok_or_else(|| unknown("schema inspection returned no result"))?;
    Ok(row.try_get::<i64>("", "count")? == 1)
}

fn unknown(message: impl Into<String>) -> SettingsPersistenceError {
    SettingsPersistenceError::UnknownSchema(message.into())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
