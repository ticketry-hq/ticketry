use super::TerminalReconciliationError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReconciliationCheckpoint {
    RuntimeObserved,
    TerminalSessionUpdated,
    RunFactApplied,
    StatusAppended,
    RepairCommitted,
    CleanupScheduled,
}

pub trait ReconciliationCheckpoints: Send + Sync {
    fn reached(
        &self,
        agent_run_id: &str,
        checkpoint: ReconciliationCheckpoint,
    ) -> Result<(), TerminalReconciliationError>;
}

pub struct NoReconciliationCheckpoints;

impl ReconciliationCheckpoints for NoReconciliationCheckpoints {
    fn reached(
        &self,
        _: &str,
        _: ReconciliationCheckpoint,
    ) -> Result<(), TerminalReconciliationError> {
        Ok(())
    }
}
