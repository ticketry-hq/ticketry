pub struct CustomQueryRegistration {
    pub field: &'static str,
    pub reason: &'static str,
    pub implementation: &'static str,
    pub parity_test: &'static str,
    pub safety_test: &'static str,
    pub bounded_test: &'static str,
}

pub const CUSTOM_QUERIES: &[CustomQueryRegistration] = &[CustomQueryRegistration {
    field: "instant_run_tickets",
    reason: "Project one safe title from private launch material while filtering to live Instant Agent Runs; registering the launch-material model would expose filesystem context, policy instructions, and the full prompt.",
    implementation: "SeaORM entities in terminal::instant_run_ticket::query",
    parity_test: "instant_run_ticket_graphql::active_instant_runs_are_projected_as_titled_tickets",
    safety_test: "instant_run_ticket_graphql::launch_material_stays_out_of_the_public_contract",
    bounded_test: "instant_run_ticket_graphql::instant_ticket_projection_is_bounded",
}];

pub fn assert_complete() {
    let registration = &CUSTOM_QUERIES[0];
    debug_assert_eq!(CUSTOM_QUERIES.len(), 1);
    debug_assert_eq!(registration.field, "instant_run_tickets");
    debug_assert!(!registration.reason.is_empty());
    debug_assert!(registration.implementation.contains("SeaORM"));
    debug_assert!(!registration.parity_test.is_empty());
    debug_assert!(!registration.safety_test.is_empty());
    debug_assert!(!registration.bounded_test.is_empty());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_custom_query_has_complete_registry_evidence() {
        assert_complete();
        let registration = &CUSTOM_QUERIES[0];
        assert!(registration.reason.contains("private launch material"));
        assert!(registration.safety_test.contains("public_contract"));
        assert!(registration.bounded_test.contains("bounded"));
    }
}
