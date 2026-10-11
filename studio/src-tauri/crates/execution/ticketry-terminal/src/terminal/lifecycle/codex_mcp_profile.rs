use ticketry_launch::{
    DurableLaunchMaterial, ExecutionAuthority, Provider, TerminalLaunchError,
    TerminalLaunchErrorCode,
};

/// Keep provider state in its original home while putting the Ticketry MCP
/// reset in a distinct configuration layer before the run's CLI override.
pub(super) fn prepare(
    durable: &DurableLaunchMaterial,
    execution: ExecutionAuthority,
    registered_profiles: &[String],
) -> Result<ExecutionAuthority, TerminalLaunchError> {
    if durable.provider != Provider::Codex {
        return Ok(execution);
    }
    ticketry_provider::provider_contract(Provider::Codex)
        .validate_profile_selection(
            ticketry_provider::ProfileSelection {
                profile: durable.options.profile.as_deref(),
                model: durable.options.model.as_deref(),
                effort: durable.options.reasoning.as_deref(),
            },
            registered_profiles,
        )
        .map_err(|error| {
            TerminalLaunchError::new(TerminalLaunchErrorCode::InvalidRequest, error.to_string())
        })?;
    let profile = ticketry_provider::prepare_codex_run_mcp_profile(
        &durable.agent_run_id,
        durable.options.profile.as_deref(),
        None,
    )
    .map_err(|_| {
        TerminalLaunchError::new(
            TerminalLaunchErrorCode::InvalidRequest,
            "Codex MCP isolation profile could not be prepared. Provider launch is blocked.",
        )
    })?;
    Ok(execution.with_codex_mcp_profile(profile))
}
