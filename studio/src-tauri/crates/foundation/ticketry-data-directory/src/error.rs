//! The error every ownership attempt can fail with.

use super::owner_record::OwnerIdentity;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    DataDirectoryInUse { owner: Option<OwnerIdentity> },
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
                write!(
                    formatter,
                    "data directory is already owned by another desktop instance"
                )
            }
            Self::Io(message) => write!(formatter, "data-directory ownership failed: {message}"),
        }
    }
}

impl std::error::Error for OwnershipError {}

pub(super) fn io_error(error: std::io::Error) -> OwnershipError {
    OwnershipError::Io(error.to_string())
}
