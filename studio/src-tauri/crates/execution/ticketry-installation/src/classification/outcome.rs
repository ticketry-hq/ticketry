//! The one answer classification is allowed to give, and the refusals.
//!
//! Every supported installation resolves to exactly one [`Installation`]. An
//! input that resolves to none of them is a [`ClassificationError`], never a
//! best guess, because the next step after classification mutates the user's
//! only working installation.

use std::path::PathBuf;

use serde::Serialize;

/// The storage engine holding the installation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Engine {
    /// The only Rust-owned desktop destination.
    Sqlite,
    /// An import source. Rust never owns a PostgreSQL installation.
    Postgresql,
}

/// One exactly identified supported SQLite generation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SqliteGeneration {
    /// The checked manifest's name for this generation.
    pub name: String,
    /// The checked schema fingerprint the installation reproduced.
    pub fingerprint: String,
    /// Product migrations recorded in the Django ledger, zero for Alembic.
    pub applied_migrations: usize,
}

/// A PostgreSQL installation, identified without connecting or mutating.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PostgresSource {
    /// The marker file declaring the source, kept for the import step.
    pub marker: PathBuf,
    /// The DSN scheme only. Credentials never reach an adoption record.
    pub scheme: String,
}

/// Which Ticketry capabilities a Rust-owned installation has already adopted.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RustOwnership {
    /// Capability ledgers present, in a stable order.
    pub adopted: Vec<String>,
    /// Capability ledgers this binary owns that the installation still lacks.
    pub pending: Vec<String>,
}

/// The exact classification of one installation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "classification", rename_all = "kebab-case")]
pub enum Installation {
    /// No installation yet. Rust provisions it at the current leaf.
    Empty,
    /// Current SQLite, adoptable in place.
    SqliteCurrent(SqliteGeneration),
    /// A supported historical SQLite generation, adoptable through a bridge.
    SqliteHistorical(SqliteGeneration),
    /// A PostgreSQL import source, left untouched.
    PostgresImportSource(PostgresSource),
    /// Rust already owns this installation. Reopening changes nothing.
    RustOwned(RustOwnership),
}

impl Installation {
    /// The engine this installation is stored in.
    #[must_use]
    pub const fn engine(&self) -> Engine {
        match self {
            Self::PostgresImportSource(_) => Engine::Postgresql,
            _ => Engine::Sqlite,
        }
    }

    /// The generation name, for evidence and fixture assertions.
    #[must_use]
    pub fn generation(&self) -> &str {
        match self {
            Self::Empty => "empty",
            Self::SqliteCurrent(generation) | Self::SqliteHistorical(generation) => {
                &generation.name
            }
            Self::PostgresImportSource(_) => "postgresql-import-source",
            Self::RustOwned(_) => "rust-owned",
        }
    }
}

/// Why classification refused, as a stable machine-readable reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Refusal {
    /// The installation path is unsafe to read as an installation.
    UnsafeInstallationPath,
    /// The source could not be opened or read at all.
    UnreadableInstallation,
    /// A product schema Ticketry has never shipped.
    UnknownSchema,
    /// A Django ledger recording a generation this release does not support.
    UnsupportedGeneration,
    /// A Django ledger missing migrations its own recorded rows depend on.
    PartialMigrationLedger,
    /// Evidence written by a newer Ticketry than this binary.
    FutureGeneration,
    /// A recognizable ledger whose physical schema is not the recorded one.
    LedgerDisagreesWithSchema,
}

/// A refusal, carrying an operator-safe explanation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClassificationError {
    reason: Refusal,
    detail: String,
}

impl ClassificationError {
    pub fn new(reason: Refusal, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: detail.into(),
        }
    }

    /// The stable reason, for callers deciding what to offer the user.
    #[must_use]
    pub const fn reason(&self) -> Refusal {
        self.reason
    }

    /// The explanation. It names schema and generation facts, never content.
    #[must_use]
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

impl std::fmt::Display for ClassificationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.reason, self.detail)
    }
}

impl std::error::Error for ClassificationError {}
