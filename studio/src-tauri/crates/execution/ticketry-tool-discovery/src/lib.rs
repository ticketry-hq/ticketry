#![deny(private_bounds, private_interfaces)]

//! Trusted executable discovery for the desktop shell.
//!
//! Discovery deliberately never asks a shell to resolve a command.  It walks
//! a small, inspectable set of directories and runs a validated candidate only
//! with its version flag and an empty environment.

mod approved_paths;
mod candidate_paths;
mod consulted;
mod diagnostics;
mod probe;
mod supported_tools;

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

// Keep discovery's implementation modules private. The root exports below are
// the supported discovery API; callers must not depend on candidate search,
// probing, or persistence module paths.
pub use approved_paths::approve_executable_path;
pub use consulted::{consulted_discovery, ConsultedDiscovery};
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
