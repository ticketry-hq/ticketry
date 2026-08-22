#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{
    TerminalOutputActivityError, TerminalOutputActivityService, TerminalOutputObservation,
};

pub struct TerminalOutputMutations;

#[CustomFields]
impl TerminalOutputMutations {
    /// Report one durable Terminal Session identity. Rust owns authorization,
    /// capture, digesting, sequencing, timestamps, and status publication.
    async fn terminal_output_observe(
        ctx: &Context<'_>,
        agent_run_id: String,
    ) -> Result<TerminalOutputObservation> {
        service(ctx)?
            .observe(&agent_run_id)
            .await
            .map_err(graphql_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    debug_assert_eq!(
        super::operation_registry::CUSTOM_OPERATIONS[0].field,
        "terminal_output_observe"
    );
    builder.register_custom_output::<TerminalOutputObservation>();
    builder.register_custom_mutation::<TerminalOutputMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a TerminalOutputActivityService> {
    ctx.data::<TerminalOutputActivityService>().map_err(|_| {
        Error::new("Terminal output observation is unavailable.")
            .extend_with(|_, extension| extension.set("code", "terminal_output_unavailable"))
    })
}

fn graphql_error(error: TerminalOutputActivityError) -> Error {
    let code = error.code().as_str();
    Error::new(error.to_string()).extend_with(move |_, extension| extension.set("code", code))
}
