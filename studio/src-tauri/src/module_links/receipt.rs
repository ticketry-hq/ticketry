//! The durable record of what a legacy import decided.
//!
//! The receipt is the artifact that makes the import reversible: it names the
//! profile file that was read, the exact rows the import owns, and every
//! legacy link it refused, with the reason. Rollback acts on this file and
//! nothing else.
//!
//! Its content is a function of the profile file and the stored rows alone. No
//! clock, run identity, or filesystem observation is recorded, so re-running an
//! import over an unchanged installation reproduces the file byte for byte and
//! the importer can leave it untouched.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{ModuleLinkError, ModuleLinkErrorCode};

/// The file name the receipt is written under, inside the data directory.
pub const RECEIPT_FILE: &str = "module-links-import.json";

/// Version of the receipt contract.
pub const VERSION: i32 = 1;

/// What became of one legacy link the importer accepted.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinkStatus {
    /// The stored row holds the value this import applied, so the import owns
    /// it and a rollback removes it.
    Imported,
    /// A row already named a different folder, so the stored choice was kept
    /// and the legacy value was not applied.
    Retained,
}

/// Why a legacy link was not adopted.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    /// The recorded folder is not a shape any row may hold.
    InvalidPath,
    /// No Module carries the identity the link names.
    UnknownModule,
    /// An earlier profile already claimed this Module.
    DuplicateLegacyLink,
}

impl SkipReason {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidPath => "invalid-path",
            Self::UnknownModule => "unknown-module",
            Self::DuplicateLegacyLink => "duplicate-legacy-link",
        }
    }
}

/// One adopted link, as the receipt records it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ImportedLink {
    pub id: String,
    pub module_id: String,
    pub path: String,
    pub status: LinkStatus,
}

/// One refused legacy link, as the receipt records it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SkippedLink {
    pub module_id: String,
    pub reason: SkipReason,
}

/// The profile file an import read.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReceiptSource {
    pub name: String,
    pub sha256: String,
}

/// The import artifact itself.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ImportReceipt {
    pub version: i32,
    /// Absent when the installation carries no profile file to import from.
    pub source: Option<ReceiptSource>,
    /// Adopted links, sorted by Module identity.
    pub links: Vec<ImportedLink>,
    /// Refused links, sorted by Module identity then reason.
    pub skipped: Vec<SkippedLink>,
}

impl ImportReceipt {
    /// Every link this import owns and a rollback may remove.
    #[must_use]
    pub fn imported(&self) -> impl Iterator<Item = &ImportedLink> {
        self.links
            .iter()
            .filter(|link| link.status == LinkStatus::Imported)
    }

    /// Where the receipt lives inside `data_directory`.
    #[must_use]
    pub fn path(data_directory: &Path) -> PathBuf {
        data_directory.join(RECEIPT_FILE)
    }

    /// Read a receipt written by this release.
    ///
    /// # Errors
    ///
    /// Returns [`ModuleLinkErrorCode::UnreadableReceipt`] when the file is not
    /// a receipt this release can act on, so a rollback refuses rather than
    /// guessing which rows it owns.
    pub fn read(path: &PathBuf) -> Result<Self, ModuleLinkError> {
        let bytes = std::fs::read(path).map_err(|error| ModuleLinkError::io(path, error))?;
        let receipt = serde_json::from_slice::<Self>(&bytes)
            .map_err(|_| ModuleLinkError::unreadable_receipt(path))?;
        if receipt.version != VERSION {
            return Err(ModuleLinkError::unreadable_receipt(path));
        }
        Ok(receipt)
    }

    /// Write the receipt only when it differs from what is already recorded.
    ///
    /// Returns whether the file changed, which is how a repeat import proves
    /// it left the installation alone.
    ///
    /// # Errors
    ///
    /// Returns [`ModuleLinkErrorCode::Io`] when the file cannot be written.
    pub fn write_if_changed(&self, data_directory: &Path) -> Result<bool, ModuleLinkError> {
        let path = Self::path(data_directory);
        let encoded = serde_json::to_vec_pretty(self).map_err(|error| {
            ModuleLinkError::new(
                ModuleLinkErrorCode::Io,
                format!("the Module Link import receipt could not be encoded: {error}"),
            )
        })?;
        if std::fs::read(&path).is_ok_and(|existing| existing == encoded) {
            return Ok(false);
        }
        crate::settings_persistence::write_json_atomically(&path, self)
            .map_err(|error| ModuleLinkError::new(ModuleLinkErrorCode::Io, error.to_string()))?;
        Ok(true)
    }
}
