//! Where a Module's code lives on this machine, answered from the typed row.
//!
//! Every runtime capability that needs a Module's folder — a worktree, a
//! terminal launch, a module shell, a design directory, an MCP module context
//! — asks this one question, and gets it answered from the link the Module
//! owns. Nothing here consults a profile, a selected index, or a feature flag,
//! so two capabilities can never disagree about which folder a Module is
//! checked out into, and no answer depends on which profile happened to be
//! selected.
//!
//! Two refusals are stated, because they are the two a caller must be able to
//! tell apart and show:
//!
//! * **Not linked.** The Module has no row. The user has never chosen a
//!   folder, or cleared the one they had.
//! * **Unusable folder.** The row names a folder this machine cannot launch
//!   in — relative, absent, not a directory, unreadable.
//!
//! A storage failure is neither: it is [`ModuleLinkError`], because a database
//! that cannot be read is not the same fact as a Module the user never linked.

use std::path::PathBuf;

use sea_orm::DatabaseConnection;

use super::store::find;
use super::ModuleLinkError;
use crate::module_links::folder_preflight::{
    validate_configured as validate_module_folder, ModuleFolderFailure,
};

/// The stable code a caller receives when no link resolves.
pub const NOT_LINKED: &str = "module_link_not_found";

/// The stable code a caller receives when the linked folder is unusable.
pub const FOLDER_INVALID: &str = "module_link_folder_invalid";

/// The stable code a caller receives when the link store itself refused.
pub const STORE_UNAVAILABLE: &str = "module_link_store_unavailable";

/// Why a Module could not be resolved to a folder a launch may run in.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModuleFolderRefusal {
    /// No typed link records a folder for this Module.
    NotLinked,
    /// A link exists, but the folder it names cannot be used.
    Unusable(&'static str),
    /// The link could not be read at all, so no folder fact was established.
    Unavailable,
}

impl ModuleFolderRefusal {
    /// The stable code a caller may branch on.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotLinked => NOT_LINKED,
            Self::Unusable(_) => FOLDER_INVALID,
            Self::Unavailable => STORE_UNAVAILABLE,
        }
    }

    /// The sentence a caller may show verbatim.
    #[must_use]
    pub fn message(&self) -> &'static str {
        match self {
            Self::NotLinked => "No local folder is linked to this module.",
            Self::Unusable(message) => message,
            Self::Unavailable => "The Module Link store is unavailable.",
        }
    }
}

impl std::fmt::Display for ModuleFolderRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl From<ModuleFolderFailure> for ModuleFolderRefusal {
    fn from(failure: ModuleFolderFailure) -> Self {
        match failure {
            ModuleFolderFailure::Unset => Self::NotLinked,
            other => Self::Unusable(other.message()),
        }
    }
}

/// The folder a Module is linked to, exactly as it is recorded.
///
/// The row is the answer; the filesystem is not consulted, because a folder
/// that is merely offline is still the folder the user chose. Callers that are
/// about to run in the folder use [`usable_folder`] instead.
///
/// # Errors
///
/// Returns [`super::ModuleLinkErrorCode::Storage`] when the read fails. An
/// unlinked Module is `Ok(None)`, because it is ordinary data.
pub async fn linked_folder(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<Option<PathBuf>, ModuleLinkError> {
    Ok(find(database, module_id)
        .await?
        .map(|link| PathBuf::from(link.path)))
}

/// The folder a Module is linked to, proven usable before it is returned.
///
/// Validation runs on every resolution rather than only at write time, because
/// a folder that was usable when it was linked can be renamed, unmounted, or
/// have its permissions changed afterwards.
///
/// # Errors
///
/// Returns [`ModuleFolderRefusal::NotLinked`] when the Module has no link,
/// [`ModuleFolderRefusal::Unusable`] when the linked folder cannot be launched
/// in, and [`ModuleFolderRefusal::Unavailable`] when the store itself refused
/// the read — three facts a caller has to be able to tell apart.
pub async fn usable_folder(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<PathBuf, ModuleFolderRefusal> {
    let recorded = linked_folder(database, module_id)
        .await
        .map_err(|_| ModuleFolderRefusal::Unavailable)?
        .ok_or(ModuleFolderRefusal::NotLinked)?;
    validate_module_folder(recorded.to_str())?;
    Ok(recorded)
}

/// The linked folder when it is usable, and nothing when it is not.
///
/// This is the shape every optional consumer wants: a status read, a design
/// directory, or a prompt fact degrades to "no folder" rather than failing, and
/// must never fall back to whatever directory the process is standing in.
pub async fn resolved_folder(database: &DatabaseConnection, module_id: &str) -> Option<PathBuf> {
    usable_folder(database, module_id).await.ok()
}
