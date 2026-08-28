//! The one ordered sequence that transfers the workspace write lease to Rust.
//!
//! Each capability owns its own adoption — read-only preflight, WAL checkpoint,
//! verified snapshot, schema classification, named bridge, semantic validation,
//! stable digest comparison, ledger installation, and restart verification — and
//! refuses an unknown schema before it mutates anything. This module supplies
//! what none of them can on its own: the order they run in, and the composed
//! check that the resulting store has exactly one production writer per table at
//! exactly the shape this build owns.
//!
//! The journal is installed first because it has never had a Django writer, so
//! installing it is idempotent and cannot fail an adoption. The two Django
//! tables are then adopted in place. Only after all three are present does the
//! composed manifest judge the store — a check that would otherwise mistake a
//! not-yet-installed journal for a drifted one.

use std::path::Path;

use super::manifest;
use super::{WorkspaceHandoffError, WorkspaceHandoffErrorCode};

/// What an operator can verify about the completed handoff. The per-capability
/// evidence files remain the authority for snapshots and digests; this record
/// says which leases moved and that the composed shape was accepted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HandoffEvidence {
    pub version: i32,
    /// Registered Design Documents preserved through adoption.
    pub document_rows: u64,
    /// Indexed Worktrees preserved through adoption.
    pub worktree_rows: u64,
    /// The composed one-writer assignment matched the live schema.
    pub ownership_validated: bool,
}

/// Adopt Documents and Worktrees, install the journal, and prove the composed
/// ownership of all three. Returns before any workspace command is composed, so
/// a refusal leaves the pre-cutover store intact and its snapshot restorable.
pub async fn adopt(data_directory: &Path) -> Result<HandoffEvidence, WorkspaceHandoffError> {
    let database = open(data_directory).await?;
    crate::workspace::operations::schema::install(&database)
        .await
        .map_err(|error| {
            unknown(format!(
                "the Workspace Operation journal could not be installed ({}): {error}",
                error.code_str()
            ))
        })?;
    database.close().await.map_err(storage)?;

    crate::documents::persistence::preflight(data_directory)
        .await
        .map_err(|error| {
            unknown(format!(
                "Documents adoption refused this store ({}): {error}",
                error.code_str()
            ))
        })?;
    let documents = crate::documents::persistence::adopt(data_directory)
        .await
        .map_err(|error| {
            unknown(format!(
                "Documents adoption failed ({}): {error}",
                error.code_str()
            ))
        })?;

    crate::worktree::persistence::preflight(data_directory)
        .await
        .map_err(|error| {
            unknown(format!(
                "Worktree adoption refused this store ({}): {error}",
                error.code_str()
            ))
        })?;
    let worktrees = crate::worktree::persistence::adopt(data_directory)
        .await
        .map_err(|error| {
            unknown(format!(
                "Worktree adoption failed ({}): {error}",
                error.code_str()
            ))
        })?;

    let database = open(data_directory).await?;
    let validated = manifest::validate_schema(&database).await;
    database.close().await.map_err(storage)?;
    validated?;

    Ok(HandoffEvidence {
        version: manifest::VERSION,
        document_rows: documents.row_count,
        worktree_rows: worktrees.row_count,
        ownership_validated: true,
    })
}

async fn open(data_directory: &Path) -> Result<sea_orm::DatabaseConnection, WorkspaceHandoffError> {
    crate::work_management::open_for_commands(&data_directory.join("state.db"))
        .await
        .map_err(|error| {
            WorkspaceHandoffError::new(
                WorkspaceHandoffErrorCode::Storage,
                format!("could not open the workspace store: {error}"),
            )
        })
}

fn storage(error: sea_orm::DbErr) -> WorkspaceHandoffError {
    WorkspaceHandoffError::new(
        WorkspaceHandoffErrorCode::Storage,
        format!("could not close the workspace store: {error}"),
    )
}

fn unknown(message: impl Into<String>) -> WorkspaceHandoffError {
    WorkspaceHandoffError::new(WorkspaceHandoffErrorCode::UnknownSchema, message)
}
