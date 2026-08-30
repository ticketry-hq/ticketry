pub struct DomainOperationRegistration {
    pub field: &'static str,
    pub reason: &'static str,
}

pub const DOMAIN_OPERATIONS: &[DomainOperationRegistration] = &[DomainOperationRegistration {
    field: "worktree_pull_request_merge_prepare",
    reason: "Merge preparation must recheck live GitHub eligibility and start a policy-resolved terminal agent in the indexed task worktree; generated Worktree model CRUD cannot perform or authorize that external launch.",
}];

pub(super) fn assert_complete() {
    debug_assert_eq!(DOMAIN_OPERATIONS.len(), 1);
    debug_assert_eq!(
        DOMAIN_OPERATIONS[0].field,
        "worktree_pull_request_merge_prepare"
    );
    debug_assert!(DOMAIN_OPERATIONS[0]
        .reason
        .contains("generated Worktree model CRUD"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_preparation_is_the_only_registered_operation_in_this_capability() {
        assert_eq!(DOMAIN_OPERATIONS.len(), 1);
        assert_eq!(
            DOMAIN_OPERATIONS[0].field,
            "worktree_pull_request_merge_prepare"
        );
        assert!(DOMAIN_OPERATIONS[0]
            .reason
            .contains("generated Worktree model CRUD"));
    }
}
