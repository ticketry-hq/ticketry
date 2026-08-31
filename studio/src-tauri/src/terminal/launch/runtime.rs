use async_trait::async_trait;

use ticketry_entities::terminals::launch_material;

use super::TerminalLaunchCheckpoint;
use ticketry_launch::terminal_session::{CreateTerminalSession, TerminalLaunchError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedTerminalRuntime {
    pub tmux_session_name: String,
    pub runtime_namespace: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalRuntimeObservation {
    Running(VerifiedTerminalRuntime),
    Exited { exit_code: Option<i32> },
    Missing,
    Foreign,
    Ambiguous,
    Unavailable,
}

/// The live-runtime port. Implementations may materialize provider argv,
/// temporary settings, hooks, and run-scoped credentials only inside
/// `materialize_and_create`; none of those values may enter launch material or
/// runtime evidence.
#[async_trait]
pub trait TerminalLaunchRuntime: Send + Sync {
    async fn preflight(&self, _request: &CreateTerminalSession) -> Result<(), TerminalLaunchError> {
        Ok(())
    }

    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation;

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError>;
}
