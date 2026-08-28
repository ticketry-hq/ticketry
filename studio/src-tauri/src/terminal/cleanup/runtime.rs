use async_trait::async_trait;

use crate::entities::terminals::session;
use crate::tmux_adapter::{
    InventoryEntry, KillOutcome, PersistedSessionName, RuntimeIdentity, RuntimeObservation,
    TmuxAdapter,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupRuntimeObservation {
    Running,
    Exited { exit_code: Option<i32> },
    Missing,
    Foreign,
    Ambiguous,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupKillResult {
    Killed,
    AlreadyMissing,
    Foreign,
    Ambiguous,
    Unconfirmed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeInventory {
    Available(Vec<InventoryEntry>),
    Unavailable,
}

#[async_trait]
pub trait TerminalCleanupRuntime: Send + Sync {
    async fn inspect(&self, terminal: &session::Model) -> CleanupRuntimeObservation;
    async fn kill_verified(&self, terminal: &session::Model) -> CleanupKillResult;

    async fn inventory(&self) -> RuntimeInventory {
        RuntimeInventory::Unavailable
    }
}

#[derive(Clone, Default)]
pub struct TmuxCleanupRuntime;

impl TmuxCleanupRuntime {
    fn adapter_and_identity(
        terminal: &session::Model,
    ) -> Result<(TmuxAdapter, RuntimeIdentity), CleanupRuntimeObservation> {
        if !PersistedSessionName::records(&terminal.tmux_session_name, &terminal.agent_run_id) {
            return Err(CleanupRuntimeObservation::Ambiguous);
        }
        let namespace = terminal
            .runtime_namespace
            .as_deref()
            .ok_or(CleanupRuntimeObservation::Ambiguous)?;
        let adapter =
            TmuxAdapter::discover().map_err(|_| CleanupRuntimeObservation::Unavailable)?;
        let identity = RuntimeIdentity::new(&terminal.agent_run_id, namespace)
            .map_err(|_| CleanupRuntimeObservation::Ambiguous)?;
        Ok((adapter, identity))
    }
}

#[async_trait]
impl TerminalCleanupRuntime for TmuxCleanupRuntime {
    async fn inspect(&self, terminal: &session::Model) -> CleanupRuntimeObservation {
        let (adapter, identity) = match Self::adapter_and_identity(terminal) {
            Ok(value) => value,
            Err(observation) => return observation,
        };
        map_observation(adapter.observe(&identity))
    }

    async fn kill_verified(&self, terminal: &session::Model) -> CleanupKillResult {
        let (adapter, identity) = match Self::adapter_and_identity(terminal) {
            Ok(value) => value,
            Err(observation) => {
                return match observation {
                    CleanupRuntimeObservation::Ambiguous => CleanupKillResult::Ambiguous,
                    _ => CleanupKillResult::Unconfirmed,
                }
            }
        };
        match adapter.kill_verified(&identity) {
            Ok(KillOutcome::Killed) => CleanupKillResult::Killed,
            Ok(KillOutcome::AlreadyMissing) => CleanupKillResult::AlreadyMissing,
            Ok(KillOutcome::Refused(RuntimeObservation::Foreign)) => CleanupKillResult::Foreign,
            Ok(KillOutcome::Refused(RuntimeObservation::Ambiguous)) => CleanupKillResult::Ambiguous,
            Ok(KillOutcome::Refused(_)) | Err(_) => CleanupKillResult::Unconfirmed,
        }
    }

    async fn inventory(&self) -> RuntimeInventory {
        match TmuxAdapter::discover().and_then(|adapter| adapter.classified_inventory()) {
            Ok(entries) => RuntimeInventory::Available(entries),
            Err(_) => RuntimeInventory::Unavailable,
        }
    }
}

fn map_observation(value: RuntimeObservation) -> CleanupRuntimeObservation {
    match value {
        RuntimeObservation::Running => CleanupRuntimeObservation::Running,
        RuntimeObservation::Exited { exit_code } => CleanupRuntimeObservation::Exited { exit_code },
        RuntimeObservation::Missing => CleanupRuntimeObservation::Missing,
        RuntimeObservation::Foreign => CleanupRuntimeObservation::Foreign,
        RuntimeObservation::Ambiguous => CleanupRuntimeObservation::Ambiguous,
        RuntimeObservation::Unavailable { .. } => CleanupRuntimeObservation::Unavailable,
    }
}
