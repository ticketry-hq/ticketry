//! The one-way, idempotent import from profile files to typed Module Links.
//!
//! The order of effects is the whole safety argument. Typed rows commit first,
//! the receipt that makes them reversible is written second, and the profile
//! file is never read for a second time, moved, rewritten, or deleted. A crash
//! at any point therefore leaves either an unchanged installation or committed
//! rows whose legacy source is still exactly where it was.
//!
//! The policies the import applies, each of which a test pins:
//!
//! * **Shape decides, presence does not.** A folder that is merely absent —
//!   an unmounted volume, a checkout the user has not cloned yet — is
//!   imported, because refusing it would silently drop a relationship the user
//!   still holds and the launch path already refuses an unusable folder. A
//!   path no row may ever hold is refused and recorded.
//! * **A Module that is gone stays gone.** A link naming an identity that is
//!   not a Module is refused rather than inserted, so the import cannot create
//!   a row the foreign key would have to cascade away later.
//! * **The stored choice wins.** An existing row is never overwritten, so a
//!   second import cannot undo a folder the user changed after the first.
//! * **Nothing is retired here.** Removing profile files from production
//!   behaviour is a later step, and it may only run against a committed,
//!   verified receipt.

use std::collections::BTreeMap;
use std::path::Path;

use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set, TransactionTrait};

use super::identity::{compact_module_id, link_id_for_module};
use super::legacy_source::{self, LegacySource};
use super::local_path::LocalModulePath;
use super::receipt::{
    ImportReceipt, ImportedLink, LinkStatus, ReceiptSource, SkipReason, SkippedLink, VERSION,
};
use super::store::{find, module_exists};
use super::{entities::module_link, schema, ModuleLinkError};

/// What one import run did.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportOutcome {
    /// The receipt as it now stands on disk.
    pub receipt: ImportReceipt,
    /// Rows this run inserted. Zero on every run after the first.
    pub inserted: usize,
    /// Whether the receipt file changed, which a repeat import must not do.
    pub receipt_changed: bool,
}

/// Import every supported legacy link into typed rows, once.
///
/// `database` is a connection the caller opened against a specific
/// installation. This module never opens one, so an import cannot reach an
/// installation the caller did not name.
///
/// # Errors
///
/// Returns [`super::ModuleLinkErrorCode::UnreadableLegacySource`] when the
/// profile file is malformed, [`super::ModuleLinkErrorCode::Schema`] when the
/// installed schema is not this release's, and
/// [`super::ModuleLinkErrorCode::Storage`] when the transaction fails. Every
/// one of those leaves the installation exactly as it was found.
pub async fn import(
    database: &DatabaseConnection,
    data_directory: &Path,
) -> Result<ImportOutcome, ModuleLinkError> {
    schema::install(database).await?;
    let Some(source) = legacy_source::locate(data_directory) else {
        return settle(
            data_directory,
            ImportReceipt {
                version: VERSION,
                source: None,
                links: Vec::new(),
                skipped: Vec::new(),
            },
            0,
        );
    };
    let catalog = legacy_source::read(&source)?;
    let digest = source_digest(&source)?;

    let mut links: BTreeMap<String, ImportedLink> = BTreeMap::new();
    let mut skipped: Vec<SkippedLink> = Vec::new();
    let mut refuse = |module_id: &str, reason: SkipReason| {
        let entry = SkippedLink {
            module_id: module_id.to_owned(),
            reason,
        };
        if !skipped.contains(&entry) {
            skipped.push(entry);
        }
    };
    let mut inserted = 0;
    let transaction = database.begin().await?;
    for candidate in legacy_source::ordered_links(&catalog) {
        // Only a Module that already has its link is a duplicate. A profile
        // that repeats a Module an earlier profile recorded badly still gets
        // its chance to supply a link the import can accept.
        if links.contains_key(&candidate.module_id) {
            refuse(&candidate.module_id, SkipReason::DuplicateLegacyLink);
            continue;
        }
        let Ok(path) = LocalModulePath::parse(&candidate.path) else {
            refuse(&candidate.module_id, SkipReason::InvalidPath);
            continue;
        };
        if !module_exists(&transaction, &candidate.module_id).await? {
            refuse(&candidate.module_id, SkipReason::UnknownModule);
            continue;
        }
        let stored = find(&transaction, &candidate.module_id).await?;
        let adopted = match stored {
            Some(existing) if existing.path == path.as_str() => ImportedLink {
                id: existing.id,
                module_id: existing.module_id,
                path: existing.path,
                status: LinkStatus::Imported,
            },
            Some(existing) => ImportedLink {
                id: existing.id,
                module_id: existing.module_id,
                path: existing.path,
                status: LinkStatus::Retained,
            },
            None => {
                let now = crate::work_management::commands::timestamp::now();
                let created = module_link::ActiveModel {
                    id: Set(link_id_for_module(&candidate.module_id)),
                    module_id: Set(compact_module_id(&candidate.module_id)),
                    path: Set(path.as_str().to_owned()),
                    created_at: Set(now),
                    updated_at: Set(now),
                }
                .insert(&transaction)
                .await?;
                inserted += 1;
                ImportedLink {
                    id: created.id,
                    module_id: created.module_id,
                    path: created.path,
                    status: LinkStatus::Imported,
                }
            }
        };
        links.insert(candidate.module_id, adopted);
    }
    transaction.commit().await?;

    skipped.sort_by(|left, right| {
        (&left.module_id, left.reason.as_str()).cmp(&(&right.module_id, right.reason.as_str()))
    });
    settle(
        data_directory,
        ImportReceipt {
            version: VERSION,
            source: Some(ReceiptSource {
                name: source.name,
                sha256: digest,
            }),
            links: links.into_values().collect(),
            skipped,
        },
        inserted,
    )
}

/// What a rollback removed.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RollbackOutcome {
    /// Rows removed because they still held the value the import applied.
    pub removed: Vec<String>,
    /// Rows left alone because they no longer hold the imported value.
    pub retained: Vec<String>,
}

/// Undo an import, leaving its legacy source recoverable.
///
/// Only rows that still hold exactly what the receipt says this import applied
/// are removed, so a folder the user changed afterwards survives a rollback.
/// The profile file is not touched — it was never modified — and the receipt is
/// removed last, so an interrupted rollback simply repeats.
///
/// # Errors
///
/// Returns [`super::ModuleLinkErrorCode::UnreadableReceipt`] when no receipt
/// this release can act on exists, and
/// [`super::ModuleLinkErrorCode::Storage`] when the transaction fails.
pub async fn rollback(
    database: &DatabaseConnection,
    data_directory: &Path,
) -> Result<RollbackOutcome, ModuleLinkError> {
    let path = ImportReceipt::path(data_directory);
    let receipt = ImportReceipt::read(&path)?;
    let mut outcome = RollbackOutcome::default();
    let transaction = database.begin().await?;
    for link in receipt.imported() {
        match find(&transaction, &link.module_id).await? {
            Some(stored) if stored.id == link.id && stored.path == link.path => {
                module_link::Entity::delete_by_id(stored.id)
                    .exec(&transaction)
                    .await?;
                outcome.removed.push(link.module_id.clone());
            }
            _ => outcome.retained.push(link.module_id.clone()),
        }
    }
    transaction.commit().await?;
    std::fs::remove_file(&path).map_err(|error| ModuleLinkError::io(&path, error))?;
    Ok(outcome)
}

fn settle(
    data_directory: &Path,
    receipt: ImportReceipt,
    inserted: usize,
) -> Result<ImportOutcome, ModuleLinkError> {
    let receipt_changed = receipt.write_if_changed(data_directory)?;
    Ok(ImportOutcome {
        receipt,
        inserted,
        receipt_changed,
    })
}

fn source_digest(source: &LegacySource) -> Result<String, ModuleLinkError> {
    use sha2::{Digest, Sha256};

    let bytes = std::fs::read(&source.path)
        .map_err(|error| ModuleLinkError::io(&source.path, error))?;
    Ok(Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
