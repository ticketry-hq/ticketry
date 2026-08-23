//! Bounded host reconciliation of durable terminal history with verified tmux
//! truth. GraphQL reads remain pure database reads and never invoke this work.

mod batch;
mod checkpoint;
mod error;
mod report;
mod service;
mod unrecorded;

pub use batch::MAX_RECORDED_SESSION_BATCH;
pub use checkpoint::{
    NoReconciliationCheckpoints, ReconciliationCheckpoint, ReconciliationCheckpoints,
};
pub use error::{TerminalReconciliationError, TerminalReconciliationErrorCode};
pub use report::{
    ReconciledSession, ReconciledUnrecordedRuntime, RecordedSessionDecision,
    RuntimeConflictDiagnostic, TerminalReconciliationReport, UnrecordedRuntimeDecision,
};
pub use service::TerminalReconciliationService;
