pub(crate) struct OutputObservationOverride {
    pub field: &'static str,
    pub generated_gap: &'static str,
    pub identity_scope: &'static str,
    pub implementation: &'static str,
    pub safety_test: &'static str,
}

pub(crate) const CUSTOM_OPERATIONS: &[OutputObservationOverride] = &[OutputObservationOverride {
    field: "terminal_output_observe",
    generated_gap: "Seaography generated update cannot capture tmux output, derive its identity, conditionally advance a counter, and append the Run projection atomically.",
    identity_scope: "One non-null Terminal Session identity; runtime namespace and project authority are derived from the stored session.",
    implementation: "TerminalOutputActivityService over SeaORM and the durable Runs status outbox.",
    safety_test: "terminal_output_activity",
}];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_operation_has_complete_override_evidence() {
        assert_eq!(CUSTOM_OPERATIONS.len(), 1);
        let entry = &CUSTOM_OPERATIONS[0];
        assert_eq!(entry.field, "terminal_output_observe");
        assert!(entry.generated_gap.contains("Seaography"));
        assert!(entry.identity_scope.contains("non-null"));
        assert!(entry.implementation.contains("SeaORM"));
        assert_eq!(entry.safety_test, "terminal_output_activity");
    }
}
