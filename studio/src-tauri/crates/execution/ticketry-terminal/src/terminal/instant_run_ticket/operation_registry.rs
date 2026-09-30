pub struct CustomReadRegistration {
    pub field: &'static str,
    pub reason: &'static str,
    pub implementation: &'static str,
    pub parity_test: &'static str,
    pub safety_test: &'static str,
    pub bounded_test: &'static str,
}

pub const CUSTOM_QUERIES: &[CustomReadRegistration] = &[
    CustomReadRegistration {
        field: "instant_run_tickets",
        reason: "Project one safe title from private launch material while filtering to live Instant Agent Runs; registering the launch-material model would expose filesystem context, policy instructions, and the full prompt.",
        implementation: "SeaORM entities in terminal::instant_run_ticket::query",
        parity_test: "instant_run_ticket_graphql::active_instant_runs_are_projected_as_titled_tickets",
        safety_test: "instant_run_ticket_graphql::launch_material_stays_out_of_the_public_contract",
        bounded_test: "instant_run_ticket_graphql::instant_ticket_projection_is_bounded",
    },
    CustomReadRegistration {
        field: "instant_run_ticket_title",
        reason: "The accepted Codex thread name lives behind the resident, read-only Codex app-server and cannot be represented by generated database entity reads.",
        implementation: "One SeaORM Launch Material and Agent Run join followed by CodexThreadTitles",
        parity_test: "instant_run_ticket_graphql::accepted_codex_thread_name_is_returned_for_eligible_agent_run",
        safety_test: "instant_run_ticket_graphql::thread_title_query_never_exposes_launch_material",
        bounded_test: "instant_run_ticket_graphql::thread_title_query_reads_one_run_with_private_material_and_one_codex_thread",
    },
];

pub const CUSTOM_SUBSCRIPTIONS: &[CustomReadRegistration] = &[CustomReadRegistration {
    field: "instant_run_ticket_title_restarted",
    reason: "A successful resident Codex app-server replacement is in-memory process state, so no generated database subscription can publish it.",
    implementation: "Codex app-server restart broadcast followed by one caller-owned title reread",
    parity_test: "instant_run_ticket_graphql::a_restarted_title_reader_notifies_graphql_then_returns_the_recovered_title",
    safety_test: "instant_run_ticket_graphql::a_restarted_title_reader_notifies_graphql_then_returns_the_recovered_title",
    bounded_test: "instant_run_ticket_graphql::a_restarted_title_reader_notifies_graphql_then_returns_the_recovered_title",
}];

pub fn assert_complete() {
    debug_assert_eq!(
        CUSTOM_QUERIES
            .iter()
            .map(|registration| registration.field)
            .collect::<Vec<_>>(),
        ["instant_run_tickets", "instant_run_ticket_title"]
    );
    debug_assert!(CUSTOM_QUERIES.iter().all(|registration| {
        !registration.reason.is_empty()
            && registration.implementation.contains("SeaORM")
            && !registration.parity_test.is_empty()
            && !registration.safety_test.is_empty()
            && !registration.bounded_test.is_empty()
    }));
    debug_assert_eq!(
        CUSTOM_SUBSCRIPTIONS
            .iter()
            .map(|registration| registration.field)
            .collect::<Vec<_>>(),
        ["instant_run_ticket_title_restarted"]
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_custom_query_has_complete_registry_evidence() {
        assert_complete();
        assert_eq!(
            CUSTOM_QUERIES
                .iter()
                .map(|registration| registration.field)
                .collect::<Vec<_>>(),
            ["instant_run_tickets", "instant_run_ticket_title"]
        );
        let registration = &CUSTOM_QUERIES[0];
        assert!(registration.reason.contains("private launch material"));
        assert!(registration.safety_test.contains("public_contract"));
        assert!(registration.bounded_test.contains("bounded"));
        let title = &CUSTOM_QUERIES[1];
        assert!(title.reason.contains("Codex app-server"));
        assert!(title.implementation.contains("SeaORM"));
        assert!(title.parity_test.contains("accepted"));
        assert!(title.safety_test.contains("launch_material"));
        assert!(title.bounded_test.contains("one_run_with_private_material"));
        let restart = &CUSTOM_SUBSCRIPTIONS[0];
        assert!(restart.reason.contains("in-memory process state"));
        assert!(restart
            .implementation
            .contains("one caller-owned title reread"));
    }
}
