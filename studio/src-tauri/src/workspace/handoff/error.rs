//! The typed refusals the Slice 4 handoff produces.
//!
//! Each one is safe to show an operator: it names a table, a capability, or a
//! readiness field, and never a rejected absolute path, a file body, a
//! credential, or a command line.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorkspaceHandoffErrorCode {
    /// The store, or this build's own manifest, is not a shape Rust may own.
    UnknownSchema,
    /// A readiness record could not be published, read, or believed.
    ReadinessUnavailable,
    /// The database could not answer.
    Storage,
}

#[derive(Debug)]
pub struct WorkspaceHandoffError {
    code: WorkspaceHandoffErrorCode,
    message: String,
}

impl WorkspaceHandoffError {
    pub(crate) fn new(code: WorkspaceHandoffErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> WorkspaceHandoffErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorkspaceHandoffErrorCode::UnknownSchema => "workspace_schema_unknown",
            WorkspaceHandoffErrorCode::ReadinessUnavailable => "workspace_readiness_unavailable",
            WorkspaceHandoffErrorCode::Storage => "workspace_storage_failed",
        }
    }
}

impl std::fmt::Display for WorkspaceHandoffError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorkspaceHandoffError {}
