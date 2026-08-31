//! Trusted executable discovery for the desktop shell.
//!
//! Discovery deliberately never asks a shell to resolve a command.  It walks
//! a small, inspectable set of directories and runs a validated candidate only
//! with its version flag and an empty environment.

pub mod approved_paths;
pub mod candidate_paths;
pub mod diagnostics;
pub mod probe;
pub mod supported_tools;

use std::env;
use std::path::{Path, PathBuf};

use approved_paths::ApprovedToolPaths;
use candidate_paths::trusted_roots;
use diagnostics::{
    candidate_diagnostic, missing_diagnostic, platform_permission_hint, working_directory_hint,
};
use probe::{inspect_candidate, version_probe};
use supported_tools::SUPPORTED_TOOLS;

use ticketry_data_directory::established_data_directory;

pub use approved_paths::approve_executable_path;
pub use diagnostics::{AccessHint, PreflightReport, ToolDiagnostic, ToolHealth};
pub use supported_tools::SupportedTool;

pub fn preflight_report() -> PreflightReport {
    let service = DiscoveryService::from_environment().unwrap_or_else(|_| DiscoveryService {
        roots: trusted_roots(env::var_os("HOME").as_deref().map(Path::new)),
        approved: ApprovedToolPaths::default(),
    });
    let tools = SUPPORTED_TOOLS
        .into_iter()
        .map(|tool| service.discover(tool))
        .collect();
    let repository_access = working_directory_hint();
    PreflightReport {
        target: format!("{}-{}", env::consts::OS, env::consts::ARCH),
        tools,
        repository_access,
        os_permission_hint: platform_permission_hint(),
    }
}

/// Environment entries for the packaged backend. The values are created only
/// from the discovery service's validated results, never from webview input.
pub fn resolved_tool_environment() -> Result<Vec<(String, String)>, String> {
    let service = DiscoveryService::from_environment()?;
    Ok(resolved_tool_environment_from_service(&service))
}

fn resolved_tool_environment_from_service(service: &DiscoveryService) -> Vec<(String, String)> {
    let mut resolved = Vec::new();
    let mut directories = Vec::new();
    for tool in SUPPORTED_TOOLS {
        let diagnostic = service.discover(tool);
        if diagnostic.health != ToolHealth::Ready {
            continue;
        }
        let path = diagnostic.path.expect("ready diagnostics have a path");
        if let Some(parent) = Path::new(&path).parent() {
            directories.push(parent.to_path_buf());
        }
        resolved.push((tool.environment_name().to_owned(), path));
    }
    directories.sort();
    directories.dedup();
    // libtmux internally uses `which("tmux")`; this deliberately bounded PATH
    // lets that dependency find only the same Rust-approved binary. Agent
    // commands are replaced with their absolute approved paths below.
    let mut probe_path = directories;
    probe_path.extend([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
    let path = env::join_paths(probe_path).unwrap_or_default();
    resolved.push(("PATH".to_owned(), path.to_string_lossy().into_owned()));
    resolved
}

struct DiscoveryService {
    roots: Vec<PathBuf>,
    approved: ApprovedToolPaths,
}

impl DiscoveryService {
    fn from_environment() -> Result<Self, String> {
        // Deliberately use HOME only to locate well-known, inspectable layouts;
        // PATH, shell configuration, and version-manager commands are never read.
        let home = env::var_os("HOME").map(PathBuf::from);
        let data_directory = established_data_directory().map_err(|error| error.to_string())?;
        Ok(Self {
            roots: trusted_roots(home.as_deref()),
            approved: ApprovedToolPaths::load(&data_directory)?,
        })
    }

    fn discover(&self, tool: SupportedTool) -> ToolDiagnostic {
        if let Some(candidate) = self.approved.path_for(tool) {
            return match inspect_candidate(candidate, tool, |path, flag| version_probe(path, flag))
            {
                Ok(diagnostic) => diagnostic,
                Err(reason) => candidate_diagnostic(tool, candidate, reason),
            };
        }
        let mut invalid = None;
        for directory in &self.roots {
            let candidate = directory.join(tool.executable_name());
            if !candidate.is_file() {
                continue;
            }
            match inspect_candidate(&candidate, tool, |path, flag| version_probe(path, flag)) {
                Ok(diagnostic) => return diagnostic,
                Err(reason) => {
                    invalid.get_or_insert_with(|| candidate_diagnostic(tool, &candidate, reason))
                }
            };
        }
        invalid.unwrap_or_else(|| missing_diagnostic(tool))
    }
}

#[cfg(test)]
mod tests;
