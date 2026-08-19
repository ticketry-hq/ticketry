//! The schema-side half of the Slice 3 readiness gate.
//!
//! Shipping compositions install this datum pointing at the data directory the
//! desktop publishes readiness into. A composition without it — the isolated
//! probe schema, and focused tests that build services directly — is already
//! its own closed world, so it is open by construction rather than by a
//! separate flag nobody would remember to set.

use std::path::{Path, PathBuf};

use seaography::async_graphql::{Context, Error, ErrorExtensions};

use super::readiness::published_readiness_is_complete;

#[derive(Clone, Debug)]
pub struct RunsReadinessGate {
    data_directory: PathBuf,
}

impl RunsReadinessGate {
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
pub(crate) fn open(ctx: &Context<'_>) -> bool {
    ctx.data_opt::<RunsReadinessGate>()
        .is_none_or(RunsReadinessGate::is_ready)
}

/// The one structured refusal every gated Runs surface returns. It names no
/// database, path, credential, prompt, or command line.
pub(crate) fn unavailable() -> Error {
    Error::new("The Runs runtime is not ready.")
        .extend_with(|_, extension| extension.set("code", "runs_unavailable"))
}

#[cfg(test)]
mod tests {
    use super::super::readiness::{publish, Slice3Readiness};
    use super::*;

    #[test]
    fn a_gate_opens_only_for_the_complete_published_result() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let gate = RunsReadinessGate::watching(directory.path());
        assert!(!gate.is_ready());

        publish(directory.path(), &Slice3Readiness::unavailable()).expect("close the gate");
        assert!(!gate.is_ready());

        publish(directory.path(), &Slice3Readiness::complete()).expect("open the gate");
        assert!(gate.is_ready());
    }
}
