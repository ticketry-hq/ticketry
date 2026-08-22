//! The error every ownership attempt can fail with.

use super::development_mode::DEVELOPMENT_MODE_ENV;
use super::owner_record::OwnerIdentity;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    DataDirectoryInUse { owner: Option<OwnerIdentity> },
    DevelopmentStackDetected { port: u16 },
    DevelopmentStackUnavailable { port: u16 },
    InvalidDevelopmentMode(String),
    Io(String),
}

impl std::fmt::Display for OwnershipError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DataDirectoryInUse { owner: Some(owner) } => write!(
                formatter,
                "data directory is already owned by live process {} (owner {})",
                owner.pid, owner.nonce
            ),
            Self::DataDirectoryInUse { owner: None } => {
                write!(formatter, "data directory is already owned by another desktop instance")
            }
            Self::DevelopmentStackDetected { port } => write!(
                formatter,
                "a development backend is listening on 127.0.0.1:{port}; stop `pnpm dev` or set {DEVELOPMENT_MODE_ENV}=connect to use it deliberately"
            ),
            Self::DevelopmentStackUnavailable { port } => write!(
                formatter,
                "connect mode requires a verified `pnpm dev` backend on 127.0.0.1:{port}; start `pnpm dev` before attaching the desktop app"
            ),
            Self::InvalidDevelopmentMode(value) => write!(
                formatter,
                "{DEVELOPMENT_MODE_ENV} must be `connect` when set, got {value:?}"
            ),
            Self::Io(message) => write!(formatter, "data-directory ownership failed: {message}"),
        }
    }
}

impl std::error::Error for OwnershipError {}

pub(super) fn io_error(error: std::io::Error) -> OwnershipError {
    OwnershipError::Io(error.to_string())
}
