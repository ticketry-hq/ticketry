#![allow(non_snake_case)]

use seaography::{
    async_graphql::{
        dynamic::{TypeRef, ValueAccessor},
        Context, Error, ErrorExtensions, Result,
    },
    BuilderContext, CustomFields, CustomInputType, SeaResult,
};

use crate::entities::terminals::session;

use super::{TerminalCleanupError, TerminalCleanupService, TerminationPatch};

pub struct GraphqlTerminationPatch(pub TerminationPatch);

impl CustomInputType for GraphqlTerminationPatch {
    fn gql_input_type_ref(_: &'static BuilderContext) -> TypeRef {
        TypeRef::named(TypeRef::STRING)
    }

    fn parse_value(
        _: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        Ok(Self(match value {
            None => TerminationPatch::Omitted,
            Some(value) if value.is_null() => TerminationPatch::Null,
            Some(value) => TerminationPatch::Request(value.string()?.to_owned()),
        }))
    }
}

pub struct TerminalSessionUpdateMutations;

#[CustomFields]
impl TerminalSessionUpdateMutations {
    /// Restricted Terminal Session update. The identity is mandatory and the
    /// only writable field is a cause identity requesting termination.
    async fn terminal_session_update(
        ctx: &Context<'_>,
        agent_run_id: String,
        termination_request_id: GraphqlTerminationPatch,
    ) -> Result<session::Model> {
        service(ctx)?
            .update_terminal_session(&agent_run_id, termination_request_id.0)
            .await
            .map_err(graphql_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<TerminalSessionUpdateMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a TerminalCleanupService> {
    ctx.data::<TerminalCleanupService>().map_err(|_| {
        typed(
            "terminal_cleanup_unavailable",
            "Terminal cleanup is unavailable.",
        )
    })
}

fn graphql_error(error: TerminalCleanupError) -> Error {
    typed(error.code_str(), &error.to_string())
}
fn typed(code: &'static str, message: &str) -> Error {
    Error::new(message.to_owned()).extend_with(|_, extension| {
        extension.set("code", code);
        extension.set("detail", message);
    })
}
