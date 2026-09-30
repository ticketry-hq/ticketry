pub struct CustomQueryRegistration {
    pub field: &'static str,
    pub reason: &'static str,
    pub implementation: &'static str,
    pub parity_test: &'static str,
    pub bounded_test: &'static str,
}

pub const CUSTOM_QUERIES: &[CustomQueryRegistration] = &[CustomQueryRegistration {
    field: "resumable_terminal_sessions",
    reason: "Select the newest ended Agent Run per provider session while excluding live conversations and live successors; generated entity reads cannot express this cross-row projection.",
    implementation: "SeaORM entities in terminal::resume::query",
    parity_test: "terminal::resume::custom_query_matches_generated_agent_run_fields",
    bounded_test: "terminal::resume::resumable_query_is_bounded_to_ten_conversations",
}];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_custom_query_has_complete_registry_evidence() {
        assert_eq!(CUSTOM_QUERIES.len(), 1);
        let query = &CUSTOM_QUERIES[0];
        assert_eq!(query.field, "resumable_terminal_sessions");
        assert!(query.reason.contains("cross-row"));
        assert!(query.implementation.contains("SeaORM"));
        assert!(query.parity_test.contains("generated"));
        assert!(query.bounded_test.contains("bounded"));
    }
}
