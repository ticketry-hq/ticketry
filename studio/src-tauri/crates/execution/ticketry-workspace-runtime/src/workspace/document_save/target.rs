//! What a save is allowed to write, derived from the registry row alone.
//!
//! A caller never names a file. It names a registered Design Document, and the
//! row says which authorized root and which relative path that is. Resolution
//! then goes through the very containment boundary the read path uses, so a
//! traversing `rel_path`, a symlink escape, a directory, an absent file, or a
//! non-Markdown document is simply not a writable target.
//!
//! The same resolution runs twice in a save's life: once when Studio asks, and
//! once when startup reconciliation re-resolves the subject from the journal.

use std::path::PathBuf;

use sea_orm::{DatabaseConnection, EntityTrait};

use ticketry_documents::{self as asset_access, MARKDOWN_MEDIA_TYPE};
use ticketry_entities::design_document;

use super::error::DocumentSaveError;
use super::identity::root_digest;

/// One writable primary Markdown document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SaveTarget {
    pub row: design_document::Model,
    /// The canonical authorized root the write must stay inside.
    pub root: PathBuf,
    /// The canonical primary file the rename replaces.
    pub path: PathBuf,
    /// The path-free identity of `root`, as the journal remembers it.
    pub root_digest: String,
}

impl SaveTarget {
    /// The directory the staged file is written into. It is the target's own
    /// directory so the rename stays on one filesystem and is therefore
    /// atomic.
    pub fn directory(&self) -> PathBuf {
        self.path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.root.clone())
    }
}

/// Resolve one registered document into a writable target.
///
/// `None` covers every reason a document is not writable — unknown identity,
/// a row whose file is gone, a path that escapes its root, and a document that
/// is not Markdown — because none of them may be told apart by a caller.
pub async fn resolve(
    database: &DatabaseConnection,
    document_id: &str,
) -> Result<Option<SaveTarget>, DocumentSaveError> {
    let Some(row) = design_document::Entity::find_by_id(document_id.to_owned())
        .one(database)
        .await?
    else {
        return Ok(None);
    };
    Ok(for_row(row))
}

/// The same resolution from an already-loaded row.
pub fn for_row(row: design_document::Model) -> Option<SaveTarget> {
    let root = PathBuf::from(&row.root_dir).canonicalize().ok()?;
    let (path, media_type) = asset_access::resolve_asset(&root, &row.rel_path)?;
    if media_type != MARKDOWN_MEDIA_TYPE {
        return None;
    }
    Some(SaveTarget {
        root_digest: root_digest(&root),
        root,
        path,
        row,
    })
}

/// The digest the file currently holds, or `None` when it cannot be read at
/// all. An unreadable target is never treated as an empty one.
pub fn current_digest(target: &SaveTarget) -> Option<String> {
    std::fs::read(&target.path)
        .ok()
        .map(|bytes| asset_access::digest(&bytes))
}
