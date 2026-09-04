//! Decide which supported generation a Django or Alembic ledger describes.
//!
//! The ledger says what a database claims to be; the schema fingerprint says
//! what it is. Both must agree with the same recorded generation, so a
//! hand-edited ledger, an interrupted migration run, or a lookalike schema is
//! refused instead of adopted.

use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::manifest::{manifest, Generation};
use super::outcome::{ClassificationError, Refusal};

/// The Django migration ledger every supported Django installation carries.
pub(crate) const DJANGO_LEDGER: &str = "django_migrations";
/// The ledger a pre-Django Alembic installation carries instead.
pub(crate) const ALEMBIC_LEDGER: &str = "alembic_version";
/// The one Alembic revision Ticketry still supports adopting.
const ALEMBIC_REVISION: &str = "0006_design_documents";
/// The generation that revision produces.
const ALEMBIC_GENERATION: &str = "alembic-0006_design_documents";

/// Match the Django ledger against exactly one recorded generation.
pub(crate) async fn classify(
    database: &DatabaseConnection,
) -> Result<&'static Generation, ClassificationError> {
    let manifest = manifest();
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT app, name FROM {DJANGO_LEDGER} ORDER BY app, name"),
        ))
        .await
        .map_err(|error| {
            ClassificationError::new(
                Refusal::UnreadableInstallation,
                format!("could not read {DJANGO_LEDGER}: {error}"),
            )
        })?;

    let mut applied = BTreeSet::new();
    for row in rows {
        let app = row.try_get::<String>("", "app").map_err(unreadable)?;
        let name = row.try_get::<String>("", "name").map_err(unreadable)?;
        if manifest.product_apps.contains(&app) {
            if !manifest.knows_product_migration(&app, &name) {
                return Err(ClassificationError::new(
                    Refusal::FutureGeneration,
                    format!(
                        "{app}.{name} is not a migration this release ships; the installation was written by a newer Ticketry"
                    ),
                ));
            }
            applied.insert(format!("{app}.{name}"));
        } else if !manifest.knows_framework_migration(&app, &name) {
            return Err(ClassificationError::new(
                Refusal::UnknownSchema,
                format!("{app}.{name} is not a migration this release recognizes"),
            ));
        }
    }

    if let Some(generation) = manifest.generation_for(&applied) {
        return Ok(generation);
    }
    let missing = manifest.missing_dependencies(&applied);
    if missing.is_empty() {
        Err(ClassificationError::new(
            Refusal::UnsupportedGeneration,
            format!(
                "{} applied product migrations describe no generation this release supports",
                applied.len()
            ),
        ))
    } else {
        Err(ClassificationError::new(
            Refusal::PartialMigrationLedger,
            format!(
                "the migration ledger is missing {} migration(s) its own rows require, starting at {}",
                missing.len(),
                missing[0]
            ),
        ))
    }
}

/// Match an Alembic ledger against the one supported pre-Django generation.
pub(crate) async fn classify_alembic(
    database: &DatabaseConnection,
) -> Result<&'static Generation, ClassificationError> {
    let revisions = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT version_num FROM {ALEMBIC_LEDGER} ORDER BY version_num"),
        ))
        .await
        .map_err(|error| {
            ClassificationError::new(
                Refusal::UnreadableInstallation,
                format!("could not read {ALEMBIC_LEDGER}: {error}"),
            )
        })?
        .into_iter()
        .map(|row| row.try_get::<String>("", "version_num").map_err(unreadable))
        .collect::<Result<Vec<_>, _>>()?;
    if revisions.as_slice() != [ALEMBIC_REVISION.to_owned()] {
        return Err(ClassificationError::new(
            Refusal::UnsupportedGeneration,
            format!(
                "{ALEMBIC_LEDGER} records {} unsupported revision(s)",
                revisions.len()
            ),
        ));
    }
    manifest().generation(ALEMBIC_GENERATION).ok_or_else(|| {
        ClassificationError::new(
            Refusal::UnsupportedGeneration,
            "the checked manifest no longer records the supported Alembic generation",
        )
    })
}

fn unreadable(error: sea_orm::DbErr) -> ClassificationError {
    ClassificationError::new(
        Refusal::UnreadableInstallation,
        format!("could not read a migration ledger row: {error}"),
    )
}
