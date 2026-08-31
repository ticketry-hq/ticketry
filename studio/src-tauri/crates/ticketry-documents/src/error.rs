//! Structured Documents failures.
//!
//! The set is deliberately small and its messages are deliberately dull: an
//! error must never disclose a rejected absolute path, a file body, or the
//! shape of the local filesystem. Absent content is not an error at all — it is
//! an empty registry or an absent asset.

use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DocumentsErrorCode {
    /// The Documents capability has not completed its startup handoff.
    Unavailable,
    /// The registry could not be read or written.
    Storage,
}

impl DocumentsErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unavailable => "documents_unavailable",
            Self::Storage => "documents_storage_failed",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentsError {
    code: DocumentsErrorCode,
    message: String,
}

impl DocumentsError {
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: DocumentsErrorCode::Unavailable,
            message: message.into(),
        }
    }

    pub fn storage(source: sea_orm::DbErr) -> Self {
        Self {
            code: DocumentsErrorCode::Storage,
            // The SeaORM message names tables and columns, never a local path
            // or a document body, so it is safe to carry as detail.
            message: format!("the document registry is unavailable: {source}"),
        }
    }

    /// A durable fact could not be appended inside a settlement transaction.
    /// It is a storage failure rather than a class of its own: the settlement
    /// rolls back, so the row and its fact stay in step.
    pub fn publication(message: impl Into<String>) -> Self {
        Self {
            code: DocumentsErrorCode::Storage,
            message: message.into(),
        }
    }

    pub fn code(&self) -> DocumentsErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        self.code.as_str()
    }
}

impl fmt::Display for DocumentsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for DocumentsError {}

impl From<sea_orm::DbErr> for DocumentsError {
    fn from(source: sea_orm::DbErr) -> Self {
        Self::storage(source)
    }
}
