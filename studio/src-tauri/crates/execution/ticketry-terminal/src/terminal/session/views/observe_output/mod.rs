#![allow(non_snake_case)]

//! Authored Terminal Session output-observation view.

mod operation_registry;

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::terminal::output_activity::{
    TerminalOutputActivityError, TerminalOutputActivityService, TerminalOutputObservation,
};

struct ObserveTerminalOutputView;

#[CustomFields]
impl ObserveTerminalOutputView {
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

pub(super) fn register(builder: &mut Builder) {
    operation_registry::assert_complete();
    builder.register_custom_output::<TerminalOutputObservation>();
    builder.register_custom_mutation::<ObserveTerminalOutputView>();
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
