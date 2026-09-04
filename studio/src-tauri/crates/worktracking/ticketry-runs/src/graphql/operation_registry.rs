pub(super) struct RunsOverride {
    pub field: &'static str,
    pub generated_gap: &'static str,
    pub identity_scope: &'static str,
    pub implementation: &'static str,
    pub safety_test: &'static str,
}

pub(super) const AUTHORED_MUTATIONS: &[RunsOverride] = &[
    RunsOverride {
        field: "retry_automation_attempt",
        generated_gap: "Generated create cannot validate lineage and append the retry plus status event atomically; Seaolim Action cannot return AutomationAttemptProjection.",
        identity_scope: "One non-null source Automation Attempt identity; root lineage and Work Item scope derive from the stored attempt.",
        implementation: "AttemptService uses one SeaORM transaction for retry eligibility, idempotent child creation, and status publication.",
        safety_test: "automation_attempts",
    },
    RunsOverride {
        field: "dismiss_automation_attempt",
        generated_gap: "Seaography rc.9 update_many cannot lock the prior attempt state and publish the status event atomically; Seaolim Action cannot return AutomationAttemptProjection.",
        identity_scope: "One non-null Automation Attempt identity; failed eligibility and Work Item scope derive from the stored attempt.",
        implementation: "AttemptService uses one SeaORM transaction for failed-only dismissal and status publication.",
        safety_test: "automation_attempts",
    },
    RunsOverride {
        field: "ingest_agent_lifecycle",
        generated_gap: "Generated update cannot enforce lifecycle ordering and idempotency with atomic status publication; Seaolim Action cannot return LifecycleAccepted.",
        identity_scope: "One non-null Agent Run identity supplied by the trusted lifecycle ingress.",
        implementation: "LifecycleService uses one SeaORM transaction for ordering, idempotency, Agent Run state, and status publication.",
        safety_test: "agent_run_lifecycle",
    },
];

pub(super) fn assert_complete() {
    debug_assert_eq!(
        AUTHORED_MUTATIONS
            .iter()
            .map(|entry| entry.field)
            .collect::<Vec<_>>(),
        [
            "retry_automation_attempt",
            "dismiss_automation_attempt",
            "ingest_agent_lifecycle",
        ]
    );
    debug_assert!(AUTHORED_MUTATIONS.iter().all(|entry| {
        !entry.generated_gap.is_empty()
            && !entry.identity_scope.is_empty()
            && !entry.implementation.is_empty()
            && !entry.safety_test.is_empty()
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_authored_runs_mutation_has_complete_override_evidence() {
        assert_eq!(
            AUTHORED_MUTATIONS
                .iter()
                .map(|entry| entry.field)
                .collect::<Vec<_>>(),
            [
                "retry_automation_attempt",
                "dismiss_automation_attempt",
                "ingest_agent_lifecycle",
            ]
        );
        for entry in AUTHORED_MUTATIONS {
            assert!(
                entry.generated_gap.contains("Seaography")
                    || entry.generated_gap.contains("Generated")
            );
            assert!(entry.generated_gap.contains("Seaolim Action"));
            assert!(entry.identity_scope.contains("non-null"));
            assert!(entry.implementation.contains("SeaORM"));
            assert!(matches!(
                entry.safety_test,
                "automation_attempts" | "agent_run_lifecycle"
            ));
        }
    }
}
