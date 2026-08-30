use seaography::async_graphql::{Context, Error, ErrorExtensions, Result};

use crate::runs_persistence::{RunsPersistenceError, RunsServices};

pub(super) fn services<'a>(ctx: &'a Context<'a>) -> Result<&'a RunsServices> {
    if !crate::runs_persistence::readiness_open(ctx) {
        return Err(crate::runs_persistence::readiness_unavailable());
    }
    ctx.data::<RunsServices>().map_err(|_| {
        Error::new("Automation Attempts are unavailable.")
            .extend_with(|_, extension| extension.set("code", "runs_persistence_unavailable"))
    })
}

pub(super) fn attempt_error(error: RunsPersistenceError) -> Error {
    let code = error.code_str();
    Error::new(error.to_string())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
