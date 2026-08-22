pub struct DomainOperationRegistration {
    pub field: &'static str,
    pub reason: &'static str,
}

pub const DOMAIN_OPERATIONS: &[DomainOperationRegistration] =
    &[DomainOperationRegistration {
        field: "run_now",
        reason: "Run Now must commit a guarded WorkItem transition before preparing a recoverable terminal launch; generated model CRUD cannot coordinate that ordering.",
    }];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_now_is_the_only_registered_operation_in_this_capability() {
        assert_eq!(DOMAIN_OPERATIONS.len(), 1);
        assert_eq!(DOMAIN_OPERATIONS[0].field, "run_now");
        assert!(DOMAIN_OPERATIONS[0].reason.contains("generated model CRUD"));
    }
}
