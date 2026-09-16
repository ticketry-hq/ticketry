pub struct DomainOperationRegistration {
    pub field: &'static str,
    pub reason: &'static str,
}

pub const DOMAIN_OPERATIONS: &[DomainOperationRegistration] = &[
    DomainOperationRegistration {
        field: "worktree_merge",
        reason: "A confirmed local Git merge mutates the selected destination checkout under live repository safety checks; generated Worktree model CRUD cannot perform or recover that external effect.",
    },
    DomainOperationRegistration {
        field: "worktree_pull_request_merge_prepare",
        reason: "Merge preparation must recheck live GitHub eligibility and start a policy-resolved terminal agent in the indexed task worktree; generated Worktree model CRUD cannot perform or authorize that external launch.",
    },
    DomainOperationRegistration {
        field: "worktree_file_diff",
        reason: "A bounded live Git patch read must validate its path against the current change set under the same repository lock; generated Worktree model CRUD cannot read a live Git patch.",
    },
    DomainOperationRegistration {
        field: "module_file_diff",
        reason: "A bounded live Git patch read must validate its path against the current module change set under the same repository lock; generated Worktree model CRUD cannot read a live Git patch.",
    },
    DomainOperationRegistration {
        field: "worktree_merge_preview",
        reason: "A local merge preview must validate live source and destination refs, checkout ownership, cleanliness, and merge eligibility; generated Worktree model CRUD cannot inspect live Git state.",
    },
];

pub(super) fn assert_complete() {
    debug_assert_eq!(DOMAIN_OPERATIONS.len(), 5);
    debug_assert_eq!(DOMAIN_OPERATIONS[0].field, "worktree_merge");
    debug_assert_eq!(
        DOMAIN_OPERATIONS[1].field,
        "worktree_pull_request_merge_prepare"
    );
    debug_assert_eq!(DOMAIN_OPERATIONS[2].field, "worktree_file_diff");
    debug_assert_eq!(DOMAIN_OPERATIONS[3].field, "module_file_diff");
    debug_assert_eq!(DOMAIN_OPERATIONS[4].field, "worktree_merge_preview");
    debug_assert!(DOMAIN_OPERATIONS[0]
        .reason
        .contains("generated Worktree model CRUD"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_named_live_git_operation_is_registered() {
        assert_eq!(DOMAIN_OPERATIONS.len(), 5);
        assert_eq!(DOMAIN_OPERATIONS[0].field, "worktree_merge");
        assert_eq!(
            DOMAIN_OPERATIONS[1].field,
            "worktree_pull_request_merge_prepare"
        );
        assert_eq!(DOMAIN_OPERATIONS[2].field, "worktree_file_diff");
        assert_eq!(DOMAIN_OPERATIONS[3].field, "module_file_diff");
        assert_eq!(DOMAIN_OPERATIONS[4].field, "worktree_merge_preview");
        assert!(DOMAIN_OPERATIONS[0]
            .reason
            .contains("generated Worktree model CRUD"));
    }
}
