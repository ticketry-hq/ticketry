#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use ticketry_entities::terminals::{launch_material, session};
use ticketry_launch::terminal_session::TerminalLaunchError;
use ticketry_terminal::terminal::cleanup::{
    CleanupCheckpoint, CleanupCheckpoints, CleanupKillResult, CleanupRuntimeObservation,
    RuntimeInventory, TerminalCleanupError, TerminalCleanupRuntime,
};
use ticketry_terminal::terminal::launch::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchRuntime,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use ticketry_terminal::terminal::reconciliation::{
    ReconciliationCheckpoint, ReconciliationCheckpoints, TerminalReconciliationError,
    TerminalReconciliationService,
};
use ticketry_terminal::tmux_adapter::InventoryEntry;

#[derive(Default)]
pub struct ScriptedRuntime {
    observations: Mutex<HashMap<String, VecDeque<CleanupRuntimeObservation>>>,
    inventory: Mutex<Vec<InventoryEntry>>,
}

impl ScriptedRuntime {
    pub fn set(&self, run_id: &str, values: impl IntoIterator<Item = CleanupRuntimeObservation>) {
        self.observations
            .lock()
            .unwrap()
            .insert(run_id.to_owned(), values.into_iter().collect());
    }

    pub fn set_inventory(&self, values: impl IntoIterator<Item = InventoryEntry>) {
        *self.inventory.lock().unwrap() = values.into_iter().collect();
    }

    fn next(&self, run_id: &str) -> CleanupRuntimeObservation {
        let mut observations = self.observations.lock().unwrap();
        let values = observations.entry(run_id.to_owned()).or_default();
        if values.len() > 1 {
            values.pop_front().unwrap()
        } else {
            values
                .front()
                .copied()
                .unwrap_or(CleanupRuntimeObservation::Missing)
        }
    }
}

#[async_trait]
impl TerminalCleanupRuntime for ScriptedRuntime {
    async fn inspect(&self, terminal: &session::Model) -> CleanupRuntimeObservation {
        self.next(&terminal.agent_run_id)
    }

    async fn kill_verified(&self, terminal: &session::Model) -> CleanupKillResult {
        self.set(&terminal.agent_run_id, [CleanupRuntimeObservation::Missing]);
        CleanupKillResult::Killed
    }

    async fn inventory(&self) -> RuntimeInventory {
        RuntimeInventory::Available(self.inventory.lock().unwrap().clone())
    }
}

#[async_trait]
impl TerminalLaunchRuntime for ScriptedRuntime {
    async fn observe(&self, run_id: &str) -> TerminalRuntimeObservation {
        match self.next(run_id) {
            CleanupRuntimeObservation::Running => {
                TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                    tmux_session_name: format!("pt-{run_id}"),
                    runtime_namespace: "reconciliation-runtime".to_owned(),
                })
            }
            CleanupRuntimeObservation::Exited { exit_code } => {
                TerminalRuntimeObservation::Exited { exit_code }
            }
            CleanupRuntimeObservation::Missing => TerminalRuntimeObservation::Missing,
            CleanupRuntimeObservation::Foreign => TerminalRuntimeObservation::Foreign,
            CleanupRuntimeObservation::Ambiguous => TerminalRuntimeObservation::Ambiguous,
            CleanupRuntimeObservation::Unavailable => TerminalRuntimeObservation::Unavailable,
        }
    }

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        self.set(&material.agent_run_id, [CleanupRuntimeObservation::Running]);
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await
    }
}

pub fn service(
    database: sea_orm::DatabaseConnection,
    runtime: Arc<ScriptedRuntime>,
) -> TerminalReconciliationService {
    let launch: Arc<dyn TerminalLaunchRuntime> = runtime.clone();
    let cleanup: Arc<dyn TerminalCleanupRuntime> = runtime;
    TerminalReconciliationService::new(database, launch, cleanup)
}

pub struct StopOnce {
    run_id: String,
    checkpoint: ReconciliationCheckpoint,
    stopped: Mutex<bool>,
}

impl StopOnce {
    pub fn new(run_id: &str, checkpoint: ReconciliationCheckpoint) -> Self {
        Self {
            run_id: run_id.to_owned(),
            checkpoint,
            stopped: Mutex::new(false),
        }
    }
}

impl ReconciliationCheckpoints for StopOnce {
    fn reached(
        &self,
        run_id: &str,
        checkpoint: ReconciliationCheckpoint,
    ) -> Result<(), TerminalReconciliationError> {
        let mut stopped = self.stopped.lock().unwrap();
        if run_id == self.run_id && checkpoint == self.checkpoint && !*stopped {
            *stopped = true;
            Err(TerminalReconciliationError::injected_checkpoint())
        } else {
            Ok(())
        }
    }
}

pub struct StopCleanupPreparation;

impl CleanupCheckpoints for StopCleanupPreparation {
    fn reached(&self, checkpoint: CleanupCheckpoint) -> Result<(), TerminalCleanupError> {
        if checkpoint == CleanupCheckpoint::Preparation {
            Err(TerminalCleanupError::injected_checkpoint())
        } else {
            Ok(())
        }
    }
}
