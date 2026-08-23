//! Give startup an exact, checked answer about the installation it found.
//!
//! Adoption is the least reversible step in the Rust migration: the step after
//! this one rewrites the user's only working installation. So classification
//! comes first, reads only, and returns exactly one supported answer or a
//! refusal. It never repairs, never provisions, and never guesses.
//!
//! The supported answers are the current SQLite generation, a recorded
//! historical SQLite generation, a PostgreSQL import source, an installation
//! Rust already owns, and an empty data directory. Everything else — a
//! lookalike schema, a partially applied migration run, evidence from a newer
//! release, a ledger that disagrees with the physical schema — is refused with
//! a stable reason while the source stays byte-for-byte restorable.
//!
//! What counts as supported lives in [`manifest`], generated from Django's own
//! migrations by `scripts/installation_corpus.py`. That manifest, not this
//! code, is the record of Ticketry's support policy.

pub mod django_ledger;
pub mod engine;
pub mod manifest;
pub mod outcome;
pub mod rust_ledger;
pub mod schema_facts;

use std::path::Path;

pub use manifest::{manifest, Manifest};
pub use outcome::{
    ClassificationError, Engine, Installation, PostgresSource, Refusal, RustOwnership,
    SqliteGeneration,
};

use manifest::Generation;
use schema_facts::ProductSchema;

/// Classify the installation in `data_directory` without changing it.
///
/// # Errors
///
/// Returns a [`ClassificationError`] when the source is not one this release
/// supports. A refusal leaves the installation untouched and reusable.
pub async fn classify(data_directory: &Path) -> Result<Installation, ClassificationError> {
    let source = engine::detect(data_directory)?;
    let database_path = match source {
        engine::Source::Unprovisioned => return Ok(Installation::Empty),
        engine::Source::Postgres(source) => {
            // PostgreSQL is an import source, never a Rust destination. It is
            // identified from its marker and left entirely alone; the import
            // itself reads it through its own consistent snapshot.
            return Ok(Installation::PostgresImportSource(source));
        }
        engine::Source::Sqlite(path) => path,
    };

    let database = engine::open_read_only(&database_path).await?;
    let outcome = classify_open(&database).await;
    // Closing is best-effort: a read-only connection has nothing to flush, and
    // a close failure must not turn a good classification into a refusal.
    let _ = database.close().await;
    outcome
}

async fn classify_open(
    database: &sea_orm::DatabaseConnection,
) -> Result<Installation, ClassificationError> {
    let tables = schema_facts::table_names(database).await.map_err(|error| {
        ClassificationError::new(
            Refusal::UnreadableInstallation,
            format!("could not list the installation's tables: {error}"),
        )
    })?;

    if let Some(ownership) = rust_ledger::inspect(database, &tables).await? {
        return Ok(Installation::RustOwned(ownership));
    }

    let has_django = tables
        .iter()
        .any(|name| name == django_ledger::DJANGO_LEDGER);
    let has_alembic = tables
        .iter()
        .any(|name| name == django_ledger::ALEMBIC_LEDGER);
    if has_django && has_alembic {
        return Err(ClassificationError::new(
            Refusal::LedgerDisagreesWithSchema,
            "the installation carries both a Django and an Alembic migration ledger",
        ));
    }

    if !has_django && !has_alembic {
        let product = tables
            .iter()
            .filter(|name| schema_facts::is_product_table(name))
            .count();
        if product == 0 {
            return Ok(Installation::Empty);
        }
        return Err(ClassificationError::new(
            Refusal::UnknownSchema,
            format!("{product} product table(s) with no migration ledger to identify them"),
        ));
    }

    let generation = if has_django {
        django_ledger::classify(database).await?
    } else {
        django_ledger::classify_alembic(database).await?
    };
    let observed = schema_facts::read(database).await.map_err(|error| {
        ClassificationError::new(
            Refusal::UnreadableInstallation,
            format!("could not read the installation's schema: {error}"),
        )
    })?;
    verify(generation, &observed)?;

    let recorded = SqliteGeneration {
        name: generation.name.clone(),
        fingerprint: generation.fingerprint.clone(),
        applied_migrations: generation.applied.len(),
    };
    if generation.name == manifest().current_generation {
        Ok(Installation::SqliteCurrent(recorded))
    } else {
        Ok(Installation::SqliteHistorical(recorded))
    }
}

/// Refuse a ledger whose physical schema is not the recorded generation's.
fn verify(generation: &Generation, observed: &ProductSchema) -> Result<(), ClassificationError> {
    let fingerprint = schema_facts::fingerprint(observed);
    if fingerprint == generation.fingerprint {
        return Ok(());
    }
    // The current generation carries full semantic facts, so its refusal can
    // name the table and the kind of change instead of two opaque digests.
    let detail = if generation.name == manifest().current_generation {
        manifest()
            .current_mismatch(observed)
            .unwrap_or_else(|| "the product schema is not the recorded current schema".to_owned())
    } else {
        format!(
            "{} product table(s) do not reproduce the schema {} recorded",
            observed.len(),
            generation.name
        )
    };
    Err(ClassificationError::new(
        Refusal::LedgerDisagreesWithSchema,
        format!(
            "the ledger claims {} but the schema disagrees: {detail}",
            generation.name
        ),
    ))
}
