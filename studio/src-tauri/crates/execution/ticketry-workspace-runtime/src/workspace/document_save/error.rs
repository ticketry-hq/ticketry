//! The typed failures of a document save.
//!
//! A stale save is *not* one of these. Losing a race with another writer is an
//! ordinary answer that carries the current digest back to the editor, so the
//! draft survives and a deliberate retry can still apply it. These errors are
//! reserved for a request that cannot be answered at all.
//!
//! Messages describe the failed contract. They never disclose a design
//! directory, a rejected path, or any part of a document body — the
//! filesystem's own diagnostic is redacted through the journal's rules before
//! it is repeated here.

use sea_orm::DbErr;

use crate::workspace::operations::{WorkspaceOperationError, WorkspaceOperationErrorCode};
use ticketry_documents::DocumentsError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum DocumentSaveErrorCode {
    /// No registered, writable primary Markdown document has that identity.
    DocumentNotFound,
    /// The submitted bytes or digests are not a usable save.
    RequestInvalid,
    /// The filesystem refused the staged write or the replacement.
    WriteFailed,
    /// The operation identity is already durable under different intent.
    OperationReplayMismatch,
    /// Another worker is acting on this operation right now.
    OperationBusy,
    /// External state contradicts the intent and is left untouched.
    ExternalConflict,
    /// The recovery journal itself refused the request.
    OperationInvalid,
    /// The database refused a read or write.
    Storage,
}

#[derive(Debug)]
pub struct DocumentSaveError {
    code: DocumentSaveErrorCode,
    message: String,
    /// The sanitized external reason, when there is one worth showing.
    detail: Option<String>,
}

impl DocumentSaveError {
    pub fn new(code: DocumentSaveErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    pub fn document_not_found() -> Self {
        Self::new(
            DocumentSaveErrorCode::DocumentNotFound,
            "No registered Markdown document matches that identity.",
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(DocumentSaveErrorCode::RequestInvalid, message)
    }

    pub fn external_conflict(code: &str, detail: &str) -> Self {
        Self {
            code: DocumentSaveErrorCode::ExternalConflict,
            message: format!("The document could not be saved ({code})."),
            detail: sanitized_detail(detail),
        }
    }

    pub fn write_failed(detail: &str) -> Self {
        Self {
            code: DocumentSaveErrorCode::WriteFailed,
            message: "The document could not be written.".to_owned(),
            detail: sanitized_detail(detail),
        }
    }

    pub fn code(&self) -> DocumentSaveErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            DocumentSaveErrorCode::DocumentNotFound => "document_save_not_found",
            DocumentSaveErrorCode::RequestInvalid => "document_save_request_invalid",
            DocumentSaveErrorCode::WriteFailed => "document_save_write_failed",
            DocumentSaveErrorCode::OperationReplayMismatch => "document_save_replay_mismatch",
            DocumentSaveErrorCode::OperationBusy => "document_save_operation_busy",
            DocumentSaveErrorCode::ExternalConflict => "document_save_external_conflict",
            DocumentSaveErrorCode::OperationInvalid => "document_save_operation_invalid",
            DocumentSaveErrorCode::Storage => "document_save_storage_failed",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

/// The filesystem's own words, bounded and stripped of anything that looks
/// like a local path, using the same rule the durable journal applies to
/// evidence.
fn sanitized_detail(detail: &str) -> Option<String> {
    let detail = detail.trim();
    if detail.is_empty() {
        return None;
    }
    Some(crate::workspace::operations::redact_diagnostic(detail))
}

impl std::fmt::Display for DocumentSaveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{} {detail}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for DocumentSaveError {}

impl From<DbErr> for DocumentSaveError {
    fn from(_: DbErr) -> Self {
        Self::new(
            DocumentSaveErrorCode::Storage,
            "The document registry could not be read or written.",
        )
    }
}

impl From<DocumentsError> for DocumentSaveError {
    fn from(error: DocumentsError) -> Self {
        Self::new(DocumentSaveErrorCode::Storage, error.to_string())
    }
}

impl From<WorkspaceOperationError> for DocumentSaveError {
    fn from(error: WorkspaceOperationError) -> Self {
        let code = match error.code() {
            WorkspaceOperationErrorCode::FingerprintConflict => {
                DocumentSaveErrorCode::OperationReplayMismatch
            }
            WorkspaceOperationErrorCode::Busy
            | WorkspaceOperationErrorCode::LeaseNotHeld
            | WorkspaceOperationErrorCode::AlreadySettled => DocumentSaveErrorCode::OperationBusy,
            WorkspaceOperationErrorCode::Storage => DocumentSaveErrorCode::Storage,
            _ => DocumentSaveErrorCode::OperationInvalid,
        };
        Self::new(code, error.to_string())
    }
}
