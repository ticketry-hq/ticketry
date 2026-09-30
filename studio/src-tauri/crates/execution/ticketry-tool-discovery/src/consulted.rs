//! What discovery consulted while resolving one tool.
//!
//! Discovery already knows which directories it is willing to walk and which
//! durable operator approval it would prefer. An observer cannot see either
//! from the outside, and a stale approval pinning a missing executable is one
//! of the ways a launch fails silently, so this reports both.

use std::path::PathBuf;

use super::approved_paths::ApprovedToolPaths;
use super::candidate_paths::trusted_roots;
use super::supported_tools::SupportedTool;
use ticketry_data_directory::established_data_directory;

/// The inputs discovery would use for `tool`, without running a probe.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConsultedDiscovery {
    /// How many trusted roots discovery is willing to walk.
    pub trusted_root_count: usize,
    /// The durable operator approval for this tool, when one is recorded.
    pub operator_approved_path: Option<PathBuf>,
}

/// Reads what discovery would consult for `tool`. Never runs the executable.
pub fn consulted_discovery(tool: SupportedTool) -> ConsultedDiscovery {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    ConsultedDiscovery {
        trusted_root_count: trusted_roots(home.as_deref()).len(),
        operator_approved_path: established_data_directory()
            .ok()
            .and_then(|directory| ApprovedToolPaths::load(&directory).ok())
            .and_then(|approved| approved.path_for(tool).map(PathBuf::from)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_always_reports_at_least_one_trusted_root() {
        let consulted = consulted_discovery(SupportedTool::Claude);
        assert!(consulted.trusted_root_count > 0);
    }
}
