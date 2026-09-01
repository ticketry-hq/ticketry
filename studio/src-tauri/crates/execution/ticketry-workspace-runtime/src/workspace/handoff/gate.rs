//! The schema-side half of the Slice 4 readiness gate.
//!
//! Shipping compositions install this datum pointing at the data directory the
//! desktop publishes readiness into. A composition without it — the isolated
//! probe schema, and focused tests that build services directly — is already its
//! own closed world, so it is open by construction rather than by a separate
//! flag nobody would remember to set.

use std::path::{Path, PathBuf};

use seaography::async_graphql::{Context, Error, ErrorExtensions};

use super::readiness::published_readiness_is_complete;

#[derive(Clone, Debug)]
pub struct WorkspaceReadinessGate {
    data_directory: PathBuf,
}

impl WorkspaceReadinessGate {
    pub fn watching(data_directory: &Path) -> Self {
        Self {
            data_directory: data_directory.to_path_buf(),
        }
    }

    pub fn is_ready(&self) -> bool {
        published_readiness_is_complete(&self.data_directory)
    }
}

/// True when this schema has no gate installed, or the installed gate is open.
pub fn open(ctx: &Context<'_>) -> bool {
    ctx.data_opt::<WorkspaceReadinessGate>()
        .is_none_or(WorkspaceReadinessGate::is_ready)
}

/// The one structured refusal every gated workspace surface returns. It names no
/// database, absolute path, credential, prompt, or command line.
pub fn unavailable() -> Error {
    Error::new("The workspace runtime is not ready.")
        .extend_with(|_, extension| extension.set("code", "workspace_unavailable"))
}

#[cfg(test)]
mod tests {
    use super::super::readiness::{publish, Slice4Readiness};
    use super::*;

    #[test]
    fn a_gate_opens_only_for_the_complete_published_result() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let gate = WorkspaceReadinessGate::watching(directory.path());
        assert!(!gate.is_ready());

        publish(directory.path(), &Slice4Readiness::unavailable()).expect("close the gate");
        assert!(!gate.is_ready());

        publish(directory.path(), &Slice4Readiness::complete()).expect("open the gate");
        assert!(gate.is_ready());
    }
}
