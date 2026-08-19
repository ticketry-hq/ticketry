//! The one writer of the Workspace Operation journal.
//!
//! Callers receive this narrow service rather than a database connection or a
//! generated model mutator, so every state change goes through the prepare,
//! claim, settle, and cleanup transactions that make the protocol recoverable.

use std::sync::Arc;

use sea_orm::DatabaseConnection;

use super::{WorkspaceOperationExecutor, WorkspaceOperationReconciler, WorkspaceStateProbe};

#[derive(Clone)]
pub struct WorkspaceOperationJournal {
    database: DatabaseConnection,
}

impl WorkspaceOperationJournal {
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }

    /// Bind the probe and executor that startup reconciliation needs. The
    /// probe observes external state; the executor performs only the effects
    /// the probe proved absent.
    pub fn reconcile_with(
        &self,
        probe: Arc<dyn WorkspaceStateProbe>,
        executor: Arc<dyn WorkspaceOperationExecutor>,
    ) -> WorkspaceOperationReconciler {
        WorkspaceOperationReconciler::new(self.clone(), probe, executor)
    }
}
