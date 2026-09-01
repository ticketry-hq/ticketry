pub(super) struct DomainOperation {
    pub field: &'static str,
    pub reason: &'static str,
}

pub(super) const DOMAIN_OPERATIONS: &[DomainOperation] = &[
    DomainOperation {
        field: "reorder_module_presentation",
        reason: "A first drag locks one Project, seeds every active ModulePresentation, validates current neighbors, and moves one rank atomically. Generated model CRUD cannot express that cross-row operation.",
    },
    DomainOperation {
        field: "reorder_work_item",
        reason: "Task reorder allocates a fractional rank between concrete sibling identities and records the project revision atomically. Generated model CRUD cannot validate that ordered gap.",
    },
    DomainOperation {
        field: "reorder_states",
        reason: "State reorder validates the complete project-owned state set and replaces its ordering atomically.",
    },
    DomainOperation {
        field: "reorder_issue_types",
        reason: "IssueType reorder validates the complete project-owned type set and replaces its ordering atomically.",
    },
    DomainOperation {
        field: "remove_state_from_issue_type_workflow",
        reason: "Workflow membership is graph reachability rather than model CRUD and requires revision-guarded transition repair.",
    },
    DomainOperation {
        field: "acknowledge_onboarding",
        reason: "Onboarding acknowledgement is a named installation workflow action rather than unrestricted Project update.",
    },
];

pub(super) fn assert_complete() {
    debug_assert_eq!(
        DOMAIN_OPERATIONS
            .iter()
            .map(|entry| entry.field)
            .collect::<Vec<_>>(),
        [
            "reorder_module_presentation",
            "reorder_work_item",
            "reorder_states",
            "reorder_issue_types",
            "remove_state_from_issue_type_workflow",
            "acknowledge_onboarding",
        ]
    );
    debug_assert!(DOMAIN_OPERATIONS
        .iter()
        .all(|entry| !entry.reason.is_empty()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_named_work_management_operation_has_a_reason() {
        assert_complete();
        assert!(DOMAIN_OPERATIONS
            .iter()
            .find(|entry| entry.field == "reorder_module_presentation")
            .unwrap()
            .reason
            .contains("Generated model CRUD"));
    }
}
