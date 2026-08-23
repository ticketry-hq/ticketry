//! The record that says Rust owns this installation, and how far it got.
//!
//! Startup has to tell three situations apart on a database it did not finish
//! adopting: nothing was ever started, the migration committed but the process
//! died before the result was validated, and the whole sequence completed. A
//! file beside the database cannot answer that — the file and the database are
//! two things that can disagree — so the answer lives in the database, written
//! in the same transaction as the migration it describes.
//!
//! The row is deliberately not a log of the adoption. It is the minimum a later
//! launch needs to decide what to do: what the source was, which release
//! adopted it, which recovery point protects it, which Rust leaf it now sits
//! at, what it contained, and whether validation finished.

use std::collections::BTreeMap;

use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbBackend, Statement,
    TransactionTrait,
};
use serde::Serialize;

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;

/// The ledger table. Its name is stable: recovery tooling looks for it.
pub const LEDGER_TABLE: &str = "ticketry_installation_adoption";

/// The ledger format this binary writes and accepts.
pub const VERSION: i32 = 1;

/// The Rust migration leaf an adopted installation is brought to.
///
/// A current SQLite source already carries the physical schema this leaf
/// describes, so adopting it moves no table. The leaf is recorded anyway
/// because it is the name future SeaORM migrations advance from, and a
/// migration that cannot say where it started cannot be applied safely.
pub const RUST_LEAF: &str = "rust-0001-adopt-current-sqlite";

/// How far the recorded adoption got.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Completion {
    /// The migration committed. Validation had not finished.
    Committed,
    /// Postflight passed and the event boundary was published.
    Ready,
}

impl Completion {
    const fn stored(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Ready => "ready",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "committed" => Some(Self::Committed),
            "ready" => Some(Self::Ready),
            _ => None,
        }
    }
}

/// What one committed adoption recorded about itself.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    /// The ledger format version.
    pub version: i32,
    /// This adoption's identity. The event boundary is keyed by it, so a
    /// restart that revalidates cannot publish a second marker.
    pub adoption_id: String,
    /// The classified generation the installation was adopted from.
    pub source_generation: String,
    /// That generation's checked product-schema fingerprint.
    pub source_fingerprint: String,
    /// The Ticketry version that performed the adoption.
    pub application_version: String,
    /// The recovery snapshot protecting it, by file name. A provisioned
    /// installation has none: there were no rows to protect.
    pub snapshot_file: Option<String>,
    /// That snapshot's SHA-256, when there is a snapshot.
    pub snapshot_sha256: Option<String>,
    /// The Rust migration leaf the installation sits at.
    pub rust_leaf: String,
    /// Ordered historical bridge IDs applied with this ownership row.
    pub bridges: Vec<String>,
    /// The canonical preserved-field digest at adoption time.
    pub preserved_digest: String,
    /// Rows per product table at adoption time.
    pub counts: BTreeMap<String, u64>,
    /// How far the adoption got.
    pub completion: Completion,
}

/// Commit the ledger and the migration it describes in one transaction.
///
/// Nothing outside this transaction may write the ledger. A crash anywhere
/// inside it leaves no row at all, which is the "not started" answer a retry
/// needs; a crash after it leaves `committed`, which is the "validate me"
/// answer a restart needs.
pub async fn commit(database: &DatabaseConnection, row: &LedgerRow) -> Result<(), AdoptionFailure> {
    let transaction = database.begin().await.map_err(failed)?;
    let outcome = write(&transaction, row).await;
    match outcome {
        Ok(()) => transaction.commit().await.map_err(failed),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

pub(super) async fn write(
    transaction: &DatabaseTransaction,
    row: &LedgerRow,
) -> Result<(), AdoptionFailure> {
    transaction
        .execute_unprepared(&format!(
            "CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} (
                singleton integer PRIMARY KEY CHECK (singleton = 1),
                version integer NOT NULL,
                adoption_id char(32) NOT NULL,
                source_generation varchar(255) NOT NULL,
                source_fingerprint char(64) NOT NULL,
                application_version varchar(64) NOT NULL,
                snapshot_file varchar(255) NULL,
                snapshot_sha256 char(64) NULL,
                rust_leaf varchar(255) NOT NULL,
                bridges text NOT NULL CHECK (json_valid(bridges)),
                preserved_digest char(64) NOT NULL,
                counts text NOT NULL CHECK (json_valid(counts)),
                completion varchar(16) NOT NULL
                    CHECK (completion IN ('committed', 'ready')),
                adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ready_at datetime NULL
            )"
        ))
        .await
        .map_err(failed)?;
    let counts = serde_json::to_string(&row.counts)
        .map_err(|error| failure(format!("could not encode adoption counts: {error}")))?;
    let bridges = serde_json::to_string(&row.bridges)
        .map_err(|error| failure(format!("could not encode adoption bridges: {error}")))?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO {LEDGER_TABLE} (
                    singleton, version, adoption_id, source_generation, source_fingerprint,
                    application_version, snapshot_file, snapshot_sha256, rust_leaf, bridges,
                    preserved_digest, counts, completion
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            [
                row.version.into(),
                row.adoption_id.clone().into(),
                row.source_generation.clone().into(),
                row.source_fingerprint.clone().into(),
                row.application_version.clone().into(),
                row.snapshot_file.clone().into(),
                row.snapshot_sha256.clone().into(),
                row.rust_leaf.clone().into(),
                bridges.into(),
                row.preserved_digest.clone().into(),
                counts.into(),
                row.completion.stored().into(),
            ],
        ))
        .await
        .map_err(failed)?;
    Ok(())
}

/// Record that validation finished and the boundary was published.
pub async fn mark_ready(database: &DatabaseConnection) -> Result<(), AdoptionFailure> {
    database
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "UPDATE {LEDGER_TABLE} SET completion = 'ready', \
                 ready_at = CURRENT_TIMESTAMP WHERE singleton = 1"
            ),
        ))
        .await
        .map_err(failed)?;
    Ok(())
}

/// Read the committed ledger, if this installation carries one.
pub async fn read(database: &DatabaseConnection) -> Result<Option<LedgerRow>, AdoptionFailure> {
    if !table_exists(database).await? {
        return Ok(None);
    }
    let Some(row) = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, adoption_id, source_generation, source_fingerprint, \
                 application_version, snapshot_file, snapshot_sha256, rust_leaf, bridges, \
                 preserved_digest, counts, completion FROM {LEDGER_TABLE} WHERE singleton = 1"
            ),
        ))
        .await
        .map_err(failed)?
    else {
        return Err(failure(format!(
            "{LEDGER_TABLE} exists but records no adoption"
        )));
    };
    let text = |name: &str| row.try_get::<String>("", name).map_err(failed);
    let version = row.try_get::<i32>("", "version").map_err(failed)?;
    if version != VERSION {
        return Err(failure(format!(
            "{LEDGER_TABLE} records adoption format {version}, which this release does not accept"
        )));
    }
    let counts = serde_json::from_str::<BTreeMap<String, u64>>(&text("counts")?)
        .map_err(|error| failure(format!("{LEDGER_TABLE} records unreadable counts: {error}")))?;
    let bridges = serde_json::from_str::<Vec<String>>(&text("bridges")?).map_err(|error| {
        failure(format!(
            "{LEDGER_TABLE} records unreadable bridges: {error}"
        ))
    })?;
    let stored = text("completion")?;
    let completion = Completion::parse(&stored).ok_or_else(|| {
        failure(format!(
            "{LEDGER_TABLE} records unknown completion state {stored}"
        ))
    })?;
    let optional = |name: &str| row.try_get::<Option<String>>("", name).map_err(failed);
    Ok(Some(LedgerRow {
        version,
        adoption_id: text("adoption_id")?,
        source_generation: text("source_generation")?,
        source_fingerprint: text("source_fingerprint")?,
        application_version: text("application_version")?,
        snapshot_file: optional("snapshot_file")?,
        snapshot_sha256: optional("snapshot_sha256")?,
        rust_leaf: text("rust_leaf")?,
        bridges,
        preserved_digest: text("preserved_digest")?,
        counts,
        completion,
    }))
}

async fn table_exists(database: &DatabaseConnection) -> Result<bool, AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
            [LEDGER_TABLE.into()],
        ))
        .await
        .map_err(failed)?
        .ok_or_else(|| failure("schema inspection returned no row".to_owned()))?;
    Ok(row.try_get::<i64>("", "present").map_err(failed)? == 1)
}

fn failed(error: impl std::fmt::Display) -> AdoptionFailure {
    failure(error.to_string())
}

fn failure(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(Phase::LedgerCommit, Refusal::LedgerFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{Completion, VERSION};

    #[test]
    fn completion_states_round_trip_through_storage() {
        for state in [Completion::Committed, Completion::Ready] {
            assert_eq!(Completion::parse(state.stored()), Some(state));
        }
    }

    #[test]
    fn an_unknown_completion_state_is_not_guessed() {
        assert_eq!(Completion::parse("half"), None);
    }

    #[test]
    fn the_ledger_format_is_the_one_classification_expects() {
        assert_eq!(VERSION, 1);
    }
}
