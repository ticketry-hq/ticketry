pub(super) struct GraphRunOverride {
    pub field: &'static str,
    pub generated_gap: &'static str,
    pub identity_scope: &'static str,
    pub implementation: &'static str,
    pub safety_test: &'static str,
}

pub(super) const RESTRICTED_MUTATIONS: &[GraphRunOverride] = &[
    GraphRunOverride {
        field: "graph_run_create",
        generated_gap: "Generated create cannot derive Project, Module, caller, policy, timestamps, and launch effects atomically; Seaolim Action cannot return GraphRunMutationPayload.",
        identity_scope: "One non-null root identity; Project and caller authority derive from the authoritative root.",
        implementation: "GraphRunService over SeaORM ActiveModels and the crash-safe Terminal launch participant.",
        safety_test: "graph_run_graphql_contract",
    },
    GraphRunOverride {
        field: "graph_run_update",
        generated_gap: "Seaography rc.9 update_many skips pre-save hooks and cannot serialize policy refresh with launch preparation; Seaolim Action cannot return GraphRunMutationPayload.",
        identity_scope: "One non-null existing root identity; Project and caller authority derive from the authoritative root.",
        implementation: "GraphRunService over SeaORM ActiveModels and the crash-safe Terminal launch participant.",
        safety_test: "graph_run_graphql_contract",
    },
    GraphRunOverride {
        field: "graph_run_delete",
        generated_gap: "Seaography rc.9 delete_many has no lifecycle hook for a serialized reset and claim cascade; Seaolim Action cannot return GraphRunDeletePayload.",
        identity_scope: "One non-null existing root identity; Project and caller authority derive from the authoritative root.",
        implementation: "GraphRunService reset transaction over Graph Run and launch-claim SeaORM entities.",
        safety_test: "graph_run_graphql_contract",
    },
];

pub(super) fn assert_complete() {
    debug_assert_eq!(
        RESTRICTED_MUTATIONS
            .iter()
            .map(|entry| entry.field)
            .collect::<Vec<_>>(),
        ["graph_run_create", "graph_run_update", "graph_run_delete"]
    );
    debug_assert!(RESTRICTED_MUTATIONS.iter().all(|entry| {
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
    fn every_restricted_mutation_has_complete_override_evidence() {
        assert_eq!(
            RESTRICTED_MUTATIONS
                .iter()
                .map(|entry| entry.field)
                .collect::<Vec<_>>(),
            ["graph_run_create", "graph_run_update", "graph_run_delete"]
        );
        for entry in RESTRICTED_MUTATIONS {
            assert!(
                entry.generated_gap.contains("Seaography")
                    || entry.generated_gap.contains("Generated")
            );
            assert!(entry.generated_gap.contains("Seaolim Action"));
            assert!(entry.identity_scope.contains("non-null"));
            assert!(entry.implementation.contains("SeaORM"));
            assert_eq!(entry.safety_test, "graph_run_graphql_contract");
        }
    }
}
