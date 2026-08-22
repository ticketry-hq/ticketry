//! The deliberate `pnpm dev` connect mode.
//!
//! A development stack already owns the data directory and its backend port.
//! Connect mode uses that stack instead of acquiring ownership; forbid mode,
//! the default, refuses to run alongside it.

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use super::advisory_lock::owner_is_alive;
use super::error::OwnershipError;

pub(super) const DEVELOPMENT_STACK_MARKER: &str = ".muxed-dev-stack.json";
pub const DEVELOPMENT_BACKEND_PORT: u16 = 8787;
pub(super) const DEVELOPMENT_MODE_ENV: &str = "MUXED_DESKTOP_DEVELOPMENT_MODE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevelopmentMode {
    /// A desktop launch must be the sole writer for its data directory.
    Forbid,
    /// Deliberately use the already-running `pnpm dev` backend instead of
    /// acquiring ownership or spawning another backend.
    Connect,
}

impl DevelopmentMode {
    pub fn from_environment() -> Result<Self, OwnershipError> {
        match env::var(DEVELOPMENT_MODE_ENV) {
            Err(env::VarError::NotPresent) => Ok(Self::Forbid),
            Ok(value) => Self::parse(&value),
            Err(error) => Err(OwnershipError::Io(error.to_string())),
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self, OwnershipError> {
        if value == "connect" {
            Ok(Self::Connect)
        } else {
            Err(OwnershipError::InvalidDevelopmentMode(value.to_owned()))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DevelopmentStackState {
    Absent,
    Verified,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct DevelopmentStackMarker {
    pub(super) data_dir: PathBuf,
    pub(super) supervisor_pid: u32,
    pub(super) backend_port: u16,
}

pub(super) fn development_stack_state(data_directory: &Path, port: u16) -> DevelopmentStackState {
    let marker_path = data_directory.join(DEVELOPMENT_STACK_MARKER);
    let marker = fs::read_to_string(&marker_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<DevelopmentStackMarker>(&contents).ok());
    if let Some(marker) = marker {
        if marker.backend_port == port
            && owner_is_alive(marker.supervisor_pid)
            && paths_match(&marker.data_dir, data_directory)
        {
            return DevelopmentStackState::Verified;
        }
        if !owner_is_alive(marker.supervisor_pid) {
            let _ = fs::remove_file(marker_path);
        }
    }
    DevelopmentStackState::Absent
}

fn paths_match(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

pub(super) fn development_stack_access(
    mode: DevelopmentMode,
    development_stack_is_running: bool,
    port: u16,
) -> Result<bool, OwnershipError> {
    if !development_stack_is_running {
        return Ok(false);
    }
    match mode {
        DevelopmentMode::Connect => Ok(true),
        DevelopmentMode::Forbid => Err(OwnershipError::DevelopmentStackDetected { port }),
    }
}
