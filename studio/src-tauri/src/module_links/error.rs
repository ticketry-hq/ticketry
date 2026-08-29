//! One typed failure for every Module Link operation.

use std::path::PathBuf;

use super::local_path::LocalPathDefect;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModuleLinkErrorCode {
    /// The installed schema is not the version this release writes.
    Schema,
    /// The database refused the read or the write.
    Storage,
    /// The submitted local path is not a shape a link may record.
    InvalidPath,
    /// The named Work Item is absent or is not a Module.
    UnknownModule,
    /// A legacy profile file exists but cannot be read as configuration.
    UnreadableLegacySource,
    /// An import receipt exists but cannot be read as this release's receipt.
    UnreadableReceipt,
    /// A file the importer owns could not be written or removed.
    Io,
}

impl ModuleLinkErrorCode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schema => "module_link_schema_unsupported",
            Self::Storage => "module_link_storage_failed",
            Self::InvalidPath => "module_link_path_invalid",
            Self::UnknownModule => "module_link_module_unknown",
            Self::UnreadableLegacySource => "module_link_legacy_source_unreadable",
            Self::UnreadableReceipt => "module_link_receipt_unreadable",
            Self::Io => "module_link_file_failed",
        }
    }
}

#[derive(Debug)]
pub struct ModuleLinkError {
    code: ModuleLinkErrorCode,
    message: String,
    source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl ModuleLinkError {
    #[must_use]
    pub fn new(code: ModuleLinkErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    #[must_use]
    pub fn code(&self) -> ModuleLinkErrorCode {
        self.code
    }

    pub(crate) fn storage(message: impl Into<String>, source: sea_orm::DbErr) -> Self {
        Self {
            code: ModuleLinkErrorCode::Storage,
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    pub(crate) fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        Self {
            code: ModuleLinkErrorCode::Io,
            message: format!("{} could not be stored", path.display()),
            source: Some(Box::new(source)),
        }
    }

    pub(crate) fn invalid_path(defect: LocalPathDefect) -> Self {
        Self::new(ModuleLinkErrorCode::InvalidPath, defect.message())
    }

    pub(crate) fn unknown_module(module_id: &str) -> Self {
        Self::new(
            ModuleLinkErrorCode::UnknownModule,
            format!("no Module is recorded with the identity {module_id}"),
        )
    }

    pub(crate) fn unreadable_legacy_source(path: &PathBuf) -> Self {
        Self::new(
            ModuleLinkErrorCode::UnreadableLegacySource,
            format!(
                "{} is not readable configuration, so no link was imported from it",
                path.display()
            ),
        )
    }

    pub(crate) fn unreadable_receipt(path: &PathBuf) -> Self {
        Self::new(
            ModuleLinkErrorCode::UnreadableReceipt,
            format!(
                "{} is not a Module Link import receipt this release can act on",
                path.display()
            ),
        )
    }
}

impl std::fmt::Display for ModuleLinkError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ModuleLinkError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|error| error.as_ref() as &(dyn std::error::Error + 'static))
    }
}

impl From<sea_orm::DbErr> for ModuleLinkError {
    fn from(source: sea_orm::DbErr) -> Self {
        Self::storage("The Module Link store refused the operation.", source)
    }
}
