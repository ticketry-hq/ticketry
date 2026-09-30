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
        self.automation_decisions > 0
            || !self.automation_failures.is_empty()
            || self
                .roots
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_automation_does_not_request_another_terminal_sweep() {
        assert!(!ExecutionReconciliationReport::default().needs_terminal_reconciliation());
    }

    #[test]
    fn dispatched_or_failed_automation_requires_terminal_observation() {
        let dispatched = ExecutionReconciliationReport {
            automation_decisions: 1,
            ..Default::default()
        };
        assert!(dispatched.needs_terminal_reconciliation());
        let failed = ExecutionReconciliationReport {
            automation_failures: vec!["dispatch may have partially completed".into()],
            ..Default::default()
        };
        assert!(failed.needs_terminal_reconciliation());
    }
}
