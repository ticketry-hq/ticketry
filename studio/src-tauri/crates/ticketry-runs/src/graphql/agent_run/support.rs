use seaography::async_graphql::{Context, Error, ErrorExtensions, Result};

use crate::persistence::{RunsPersistenceError, RunsServices};

pub(super) fn services<'a>(ctx: &'a Context<'a>) -> Result<&'a RunsServices> {
    if !crate::persistence::readiness_open(ctx) {
        return Err(crate::persistence::readiness_unavailable());
    }
    ctx.data::<RunsServices>().map_err(|_| unavailable())
}

fn unavailable() -> Error {
    Error::new("The Runs service is unavailable.")
        .extend_with(|_, extension| extension.set("code", "runs_unavailable"))
}

pub(super) fn graphql_error(error: RunsPersistenceError) -> Error {
    Error::new("The Agent Run operation could not be completed.")
        .extend_with(|_, extension| extension.set("code", error.code_str()))
}
