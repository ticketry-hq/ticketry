use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum TerminalPersistenceErrorCode {
    AdoptionUnavailable,
    IncompatibleSchema,
    InvalidMetadata,
    Storage,
}

#[derive(Debug)]
pub struct TerminalPersistenceError {
    code: TerminalPersistenceErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl TerminalPersistenceError {
    pub(crate) fn new(code: TerminalPersistenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub(crate) fn storage(context: &'static str, source: DbErr) -> Self {
        Self {
            code: TerminalPersistenceErrorCode::Storage,
            message: context.to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> TerminalPersistenceErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            TerminalPersistenceErrorCode::AdoptionUnavailable => "terminal_adoption_unavailable",
            TerminalPersistenceErrorCode::IncompatibleSchema => "terminal_schema_incompatible",
            TerminalPersistenceErrorCode::InvalidMetadata => "terminal_metadata_invalid",
            TerminalPersistenceErrorCode::Storage => "terminal_storage_failed",
        }
    }
}

impl std::fmt::Display for TerminalPersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalPersistenceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for TerminalPersistenceError {
    fn from(source: DbErr) -> Self {
        Self::storage("Terminal storage operation failed", source)
    }
}
