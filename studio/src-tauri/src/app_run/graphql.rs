#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{AppRunError, AppRunService, AppRunStatus};

pub struct AppRunQueries;
pub struct AppRunMutations;

#[CustomFields]
impl AppRunQueries {
    async fn app_run(ctx: &Context<'_>, module_id: String) -> Result<AppRunStatus> {
        service(ctx)?
            .status(&module_id)
            .await
            .map_err(graphql_error)
    }
}

#[CustomFields]
impl AppRunMutations {
    async fn app_run_start(
        ctx: &Context<'_>,
        module_id: String,
        columns: i32,
        rows: i32,
    ) -> Result<AppRunStatus> {
        let columns = u16::try_from(columns)
            .map_err(|_| typed("app_run_invalid", "App run columns are invalid."))?;
        let rows = u16::try_from(rows)
            .map_err(|_| typed("app_run_invalid", "App run rows are invalid."))?;
        service(ctx)?
            .start(&module_id, columns, rows)
            .await
            .map_err(graphql_error)
    }

    async fn app_run_stop(ctx: &Context<'_>, module_id: String) -> Result<AppRunStatus> {
        service(ctx)?.stop(&module_id).await.map_err(graphql_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<AppRunStatus>();
    builder.register_custom_query::<AppRunQueries>();
    builder.register_custom_mutation::<AppRunMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a AppRunService> {
    ctx.data::<AppRunService>()
        .map_err(|_| typed("app_run_unavailable", "App runs are unavailable."))
}

fn graphql_error(error: AppRunError) -> Error {
    typed(error.code(), &error.to_string())
}

fn typed(code: &'static str, message: &str) -> Error {
    Error::new(message.to_owned())
        .extend_with(|_, extensions| extensions.set("code", code))
        .extend_with(|_, extensions| extensions.set("detail", message))
}
