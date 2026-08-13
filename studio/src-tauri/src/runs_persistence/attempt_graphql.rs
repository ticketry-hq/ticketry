#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{AutomationAttemptProjection, RunsPersistenceError, RunsServices};

pub struct AttemptQueries;

#[CustomFields]
impl AttemptQueries {
    async fn automation_attempts(
        ctx: &Context<'_>,
        project_id: String,
        task_id: Option<String>,
    ) -> Result<Vec<AutomationAttemptProjection>> {
        services(ctx)?
            .attempts()
            .latest(&project_id, task_id.as_deref())
            .await
            .map_err(attempt_error)
    }
}

pub struct AttemptMutations;

#[CustomFields]
impl AttemptMutations {
    async fn retry_automation_attempt(
        ctx: &Context<'_>,
        attempt_id: String,
    ) -> Result<AutomationAttemptProjection> {
        services(ctx)?
            .attempts()
            .retry(&attempt_id)
            .await
            .map_err(attempt_error)
    }

    async fn dismiss_automation_attempt(
        ctx: &Context<'_>,
        attempt_id: String,
    ) -> Result<AutomationAttemptProjection> {
        services(ctx)?
            .attempts()
            .dismiss(&attempt_id)
            .await
            .map_err(attempt_error)
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<AutomationAttemptProjection>();
    builder.register_custom_query::<AttemptQueries>();
    builder.register_custom_mutation::<AttemptMutations>();
    builder
}

fn services<'a>(ctx: &'a Context<'a>) -> Result<&'a RunsServices> {
    ctx.data::<RunsServices>().map_err(|_| {
        Error::new("Automation Attempts are unavailable.")
            .extend_with(|_, extension| extension.set("code", "runs_persistence_unavailable"))
    })
}

fn attempt_error(error: RunsPersistenceError) -> Error {
    let code = error.code_str();
    Error::new(error.to_string())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
