//! Where the data directory is.
//!
//! Browser development and installed desktop builds share one path. Resolving
//! it never moves or copies configuration.

use std::env;
use std::path::PathBuf;

use super::error::OwnershipError;

/// The existing path shared by browser development and installed desktop
/// builds.  This deliberately does not move or copy configuration.
pub fn established_data_directory() -> Result<PathBuf, OwnershipError> {
    if let Some(value) = env::var_os("MUXED_DATA_DIR") {
        if !value.is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    let home = env::var_os("HOME").ok_or_else(|| {
        OwnershipError::Io("could not determine HOME for the established data directory".to_owned())
    })?;
    Ok(PathBuf::from(home).join(".config/worktracker-studio"))
}
