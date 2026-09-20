//! Which MCP tools are provider-owned custom mutations, and why generated
//! database CRUD cannot serve them.
//!
//! Every other write this listener dispatches lands in a Ticketry table through
//! work-management commands over SeaORM. The tools recorded here do not, so
//! each one carries the gap it fills and the tests that keep it honest.

pub(super) struct ProviderMutationRegistration {
    /// The MCP tool name, exactly as `registry::tools()` publishes it.
    pub field: &'static str,
    pub generated_gap: &'static str,
    pub implementation: &'static str,
    pub parity_test: &'static str,
    pub safety_test: &'static str,
}

pub(super) const PROVIDER_MUTATIONS: &[ProviderMutationRegistration] =
    &[ProviderMutationRegistration {
        field: "rename_codex_thread",
        generated_gap: "Codex owns thread names in its own on-disk state, outside every Ticketry table, so Seaography-generated model CRUD has no row to write and no entity to register.",
        implementation: "InstantRunTicketTitleService::rename_thread over the one resident CodexAppServerClient, reached through codex_thread_rename.",
        parity_test: "mcp_acceptance::codex_rename::an_authorized_client_renames_a_thread_through_the_resident_app_server",
        safety_test: "mcp_acceptance::codex_rename::rename_refusals_stay_structured_and_private",
    }];

/// Hold the record equal to the live tool surface. Startup runs this beside the
/// duplicate-name check, so a registered provider mutation that loses its tool
/// — or a second one added without evidence — fails before the socket binds.
pub(super) fn assert_complete(tools: &[rmcp::model::Tool]) -> Result<(), String> {
    for registration in PROVIDER_MUTATIONS {
        if !tools
            .iter()
            .any(|tool| tool.name.as_ref() == registration.field)
        {
            return Err(format!(
                "{} is recorded as a provider-owned MCP mutation but is not a registered tool.",
                registration.field
            ));
        }
        if registration.generated_gap.is_empty()
            || registration.implementation.is_empty()
            || registration.parity_test.is_empty()
            || registration.safety_test.is_empty()
        {
            return Err(format!(
                "{} is missing its generated-CRUD exception evidence.",
                registration.field
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_codex_thread_is_the_only_provider_owned_mutation() {
        assert_eq!(PROVIDER_MUTATIONS.len(), 1);
        assert_eq!(PROVIDER_MUTATIONS[0].field, "rename_codex_thread");
        assert!(PROVIDER_MUTATIONS[0]
            .generated_gap
            .contains("Seaography-generated model CRUD"));
    }

    #[test]
    fn every_provider_owned_mutation_is_a_registered_tool_with_evidence() {
        assert_complete(&super::super::registry::tools()).unwrap();
    }
}
