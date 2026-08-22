#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootReconciliation {
    pub root_id: String,
    pub launched_task_ids: Vec<String>,
    pub terminal_reconciliation_requested: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExecutionReconciliationReport {
    pub automation_decisions: usize,
    pub automation_failures: Vec<String>,
    pub diagnostics: Vec<String>,
    pub roots: Vec<RootReconciliation>,
    pub next_root_id: Option<String>,
}

impl ExecutionReconciliationReport {
    pub fn needs_terminal_reconciliation(&self) -> bool {
        self.roots
            .iter()
            .any(|root| root.terminal_reconciliation_requested)
    }

    pub fn merge(&mut self, mut other: Self) {
        self.automation_decisions += other.automation_decisions;
        self.automation_failures
            .append(&mut other.automation_failures);
        self.diagnostics.append(&mut other.diagnostics);
        self.roots.append(&mut other.roots);
        self.next_root_id = other.next_root_id;
    }
}
