//! What discovery reports back about one tool, and the guidance shown when a
//! tool is missing or unusable.

use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use super::supported_tools::SupportedTool;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolHealth {
    Ready,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiagnostic {
    pub tool: SupportedTool,
    pub health: ToolHealth,
    pub path: Option<String>,
    pub version: Option<String>,
    pub executable: bool,
    pub architecture: String,
    pub capabilities: Vec<String>,
    pub guidance: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessHint {
    pub working_directory: String,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
    pub guidance: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub target: String,
    pub tools: Vec<ToolDiagnostic>,
    pub repository_access: AccessHint,
    pub os_permission_hint: Option<String>,
}

pub(super) fn missing_diagnostic(tool: SupportedTool) -> ToolDiagnostic {
    ToolDiagnostic {
        tool,
        health: ToolHealth::Missing,
        path: None,
        version: None,
        executable: false,
        architecture: "unknown".to_owned(),
        capabilities: Vec::new(),
        guidance: Some(missing_guidance(tool)),
    }
}

fn missing_guidance(tool: SupportedTool) -> String {
    if tool == SupportedTool::Tmux {
        return match env::consts::OS {
            "macos" => "tmux is a macOS prerequisite; Ticketry does not bundle it. Install it with Homebrew (`brew install tmux`) or approve a compatible absolute path.".to_owned(),
            "linux" => "tmux is a Linux prerequisite; install it through your distribution package manager or approve a compatible absolute path.".to_owned(),
            "windows" => "Windows is not a supported desktop target because Ticketry requires tmux.".to_owned(),
            _ => "tmux is required by Ticketry and must be installed through the supported platform workflow.".to_owned(),
        };
    }
    format!(
        "{} was not found in trusted desktop locations; install it with your platform's supported package workflow or approve its absolute path.",
        tool.executable_name()
    )
}

pub(super) fn candidate_diagnostic(
    tool: SupportedTool,
    path: &Path,
    reason: String,
) -> ToolDiagnostic {
    ToolDiagnostic {
        tool,
        health: ToolHealth::Invalid,
        path: Some(display_path(path)),
        version: None,
        executable: false,
        architecture: "unknown".to_owned(),
        capabilities: Vec::new(),
        guidance: Some(reason),
    }
}

pub(super) fn display_path(path: &Path) -> String {
    // A filesystem path contains no credentials. Do not include command output,
    // environment values, or arbitrary errors in the serializable report.
    path.to_string_lossy().into_owned()
}

pub(super) fn working_directory_hint() -> AccessHint {
    let path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exists = path.exists();
    let readable = fs::read_dir(&path).is_ok();
    let writable = if exists {
        let probe = path.join(format!(".muxed-preflight-{}", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(_) => {
                let _ = fs::remove_file(probe);
                true
            }
            Err(_) => false,
        }
    } else {
        false
    };
    AccessHint {
        working_directory: display_path(&path),
        exists,
        readable,
        writable,
        guidance: (!exists || !readable || !writable).then(|| {
            "Choose a local repository directory that the desktop app can read and write."
                .to_owned()
        }),
    }
}

pub(super) fn platform_permission_hint() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Some("If the repository is in Desktop, Documents, or another protected location, grant Ticketry Files and Folders access in macOS Settings.".to_owned())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
