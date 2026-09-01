use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum DocumentsPersistenceErrorCode {
    AdoptionUnavailable,
    IncompatibleSchema,
    InvalidRegistry,
    Storage,
}

#[derive(Debug)]
pub struct DocumentsPersistenceError {
    code: DocumentsPersistenceErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl DocumentsPersistenceError {
    pub fn new(code: DocumentsPersistenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub fn storage(context: &'static str, source: DbErr) -> Self {
        Self {
            code: DocumentsPersistenceErrorCode::Storage,
            message: context.to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> DocumentsPersistenceErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            DocumentsPersistenceErrorCode::AdoptionUnavailable => "documents_adoption_unavailable",
            DocumentsPersistenceErrorCode::IncompatibleSchema => "documents_schema_incompatible",
            DocumentsPersistenceErrorCode::InvalidRegistry => "documents_registry_invalid",
            DocumentsPersistenceErrorCode::Storage => "documents_storage_failed",
        }
    }
}

impl std::fmt::Display for DocumentsPersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for DocumentsPersistenceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for DocumentsPersistenceError {
    fn from(source: DbErr) -> Self {
        Self::storage("Documents storage operation failed", source)
    }
}
