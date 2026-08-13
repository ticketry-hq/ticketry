use std::path::PathBuf;

use sea_orm::DbErr;

#[derive(Debug)]
pub enum SettingsPersistenceError {
    IndexOutOfRange,
    InvalidProfileField {
        field: &'static str,
    },
    InvalidIdentity {
        field: &'static str,
    },
    CorruptJson {
        path: PathBuf,
    },
    UnknownSchema(String),
    Database(DbErr),
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    Json(serde_json::Error),
    ConcurrentAccess,
}

impl SettingsPersistenceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::IndexOutOfRange => "index_out_of_range",
            Self::InvalidProfileField { .. } => "invalid_profile",
            Self::InvalidIdentity { .. } => "invalid_setting_identity",
            Self::CorruptJson { .. } => "configuration_corrupt",
            Self::UnknownSchema(_) => "unknown_settings_schema",
            Self::Database(_) => "settings_storage_failed",
            Self::Io { .. } => "settings_file_failed",
            Self::Json(_) => "settings_encoding_failed",
            Self::ConcurrentAccess => "settings_store_unavailable",
        }
    }

    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}

impl std::fmt::Display for SettingsPersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IndexOutOfRange => formatter.write_str("profile index is out of range"),
            Self::InvalidProfileField { field } => {
                write!(formatter, "{field} must be a JSON object")
            }
            Self::InvalidIdentity { field } => write!(formatter, "{field} cannot be empty"),
            Self::CorruptJson { path } => write!(
                formatter,
                "settings file {} is malformed and was left unchanged",
                path.display()
            ),
            Self::UnknownSchema(message) => formatter.write_str(message),
            Self::Database(_) => formatter.write_str("settings could not be stored"),
            Self::Io { path, .. } => {
                write!(
                    formatter,
                    "settings file {} could not be stored",
                    path.display()
                )
            }
            Self::Json(_) => formatter.write_str("settings could not be encoded"),
            Self::ConcurrentAccess => formatter.write_str("settings store lock was poisoned"),
        }
    }
}

impl std::error::Error for SettingsPersistenceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Io { source, .. } => Some(source),
            Self::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl From<DbErr> for SettingsPersistenceError {
    fn from(error: DbErr) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for SettingsPersistenceError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}
