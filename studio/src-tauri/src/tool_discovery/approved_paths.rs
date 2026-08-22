//! Durable, operator-chosen paths for named tools.
//!
//! An approved path is still only a candidate: it passes the same inspection
//! as an automatically discovered one before it is ever run.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::diagnostics::ToolDiagnostic;
use super::probe::{inspect_candidate, version_probe};
use super::supported_tools::SupportedTool;
use crate::data_directory::established_data_directory;

pub(super) const APPROVED_PATHS_FILE: &str = "approved-executables.json";

/// A fixed selection made through the desktop's named-tool approval command.
/// The path itself is never executable until it passes the same inspection as
/// an automatically discovered candidate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedToolPath {
    tool: SupportedTool,
    path: PathBuf,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApprovedToolPaths {
    tools: Vec<ApprovedToolPath>,
}

impl ApprovedToolPaths {
    pub(super) fn load(data_directory: &Path) -> Result<Self, String> {
        let path = data_directory.join(APPROVED_PATHS_FILE);
        match fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents)
                .map_err(|_| "saved executable approvals are unreadable".to_owned()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("saved executable approvals could not be read".to_owned()),
        }
    }

    pub(super) fn path_for(&self, tool: SupportedTool) -> Option<&Path> {
        self.tools
            .iter()
            .find(|choice| choice.tool == tool)
            .map(|choice| choice.path.as_path())
    }

    fn replace(&mut self, tool: SupportedTool, path: PathBuf) {
        self.tools.retain(|choice| choice.tool != tool);
        self.tools.push(ApprovedToolPath { tool, path });
        self.tools
            .sort_by_key(|choice| choice.tool.executable_name());
    }

    fn save(&self, data_directory: &Path) -> Result<(), String> {
        fs::create_dir_all(data_directory)
            .map_err(|_| "approved executable directory could not be created".to_owned())?;
        let destination = data_directory.join(APPROVED_PATHS_FILE);
        let temporary =
            data_directory.join(format!(".{APPROVED_PATHS_FILE}.tmp-{}", std::process::id()));
        let encoded = serde_json::to_vec_pretty(self)
            .map_err(|_| "approved executable selections could not be encoded".to_owned())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "approved executable selections could not be saved".to_owned())?;
        file.write_all(&encoded)
            .and_then(|_| file.sync_all())
            .map_err(|_| "approved executable selections could not be saved".to_owned())?;
        fs::rename(&temporary, destination)
            .map_err(|_| "approved executable selections could not be saved".to_owned())
    }
}

/// Validate and durably approve one absolute path for one named tool. This is
/// intentionally the only path-bearing desktop command; it cannot choose a
/// program name, arguments, shell, or environment.
pub fn approve_executable_path(
    tool: SupportedTool,
    candidate: PathBuf,
) -> Result<ToolDiagnostic, String> {
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    approve_executable_path_in(&data_directory, tool, candidate)
}

pub(super) fn approve_executable_path_in(
    data_directory: &Path,
    tool: SupportedTool,
    candidate: PathBuf,
) -> Result<ToolDiagnostic, String> {
    if !candidate.is_absolute() {
        return Err("approved executable path must be absolute".to_owned());
    }
    let candidate = fs::canonicalize(&candidate)
        .map_err(|_| "approved executable path could not be resolved".to_owned())?;
    let diagnostic = inspect_candidate(&candidate, tool, |path, flag| version_probe(path, flag))?;
    let mut approved = ApprovedToolPaths::load(data_directory)?;
    approved.replace(tool, candidate);
    approved.save(data_directory)?;
    Ok(diagnostic)
}
