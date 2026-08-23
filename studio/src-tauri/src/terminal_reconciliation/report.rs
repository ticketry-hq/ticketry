use crate::terminal_cleanup::TerminalCleanupRecoveryReport;
use crate::terminal_launch::TerminalLaunchRecoveryReport;
use crate::tmux_adapter::InventoryConflictKind;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordedSessionDecision {
    Running,
    Exited,
    Lost,
    Recovered,
    Unavailable,
    Conflict,
    Unchanged,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReconciledSession {
    pub agent_run_id: String,
    pub decision: RecordedSessionDecision,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnrecordedRuntimeDecision {
    Adopted,
    PendingLaunch,
    Quarantined,
    AlreadyRecorded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReconciledUnrecordedRuntime {
    pub agent_run_id: String,
    pub decision: UnrecordedRuntimeDecision,
    pub legacy_namespace: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeConflictDiagnostic {
    pub fingerprint: String,
    pub kind: InventoryConflictKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalReconciliationReport {
    pub launches: TerminalLaunchRecoveryReport,
    pub cleanups: TerminalCleanupRecoveryReport,
    pub sessions: Vec<ReconciledSession>,
    /// The bounded batch left a recorded row uninspected. The scan cursor keeps
    /// its place, so a later pass inspects that row.
    pub sessions_saturated: bool,
    pub unrecorded: Vec<ReconciledUnrecordedRuntime>,
    pub conflicts: Vec<RuntimeConflictDiagnostic>,
    pub inventory_unavailable: bool,
}
