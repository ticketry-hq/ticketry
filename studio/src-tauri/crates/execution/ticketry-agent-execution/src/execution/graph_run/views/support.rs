use sea_orm::{DatabaseConnection, EntityTrait};
use seaography::async_graphql::{Context, Error, ErrorExtensions, Result};

use crate::{
    execution::graph::{ExecutionMode, GraphAccess},
    graph_run_service::{GraphRunCaller, GraphRunRequest, GraphRunService, GraphRunServiceError},
};
use ticketry_entities::issue;

pub(super) async fn request(
    ctx: &Context<'_>,
    root_id: &str,
    execution_mode: Option<String>,
) -> Result<GraphRunRequest> {
    Ok(GraphRunRequest {
        root_id: root_id.to_owned(),
        access: caller_access(ctx, root_id).await?,
        mode: parse_mode(execution_mode.as_deref())?,
        provider_override: None,
    })
}

pub(super) async fn caller_access(ctx: &Context<'_>, root_id: &str) -> Result<GraphAccess> {
    if ctx.data_opt::<GraphRunCaller>().is_none() {
        return Err(typed(
            "graph_unauthorized",
            "The caller is not authorized for Graph Runs.",
        ));
    }
    let database = ctx
        .data::<DatabaseConnection>()
        .map_err(|_| unavailable())?;
    let compact_root = compact(root_id);
    let root = issue::Entity::find_by_id(&compact_root)
        .one(database)
        .await
        .map_err(|_| storage_failure())?
        .filter(|root| root.r#type == "task")
        .ok_or_else(|| typed("task_not_found", "Dependency graph root was not found."))?;
    Ok(GraphAccess::caller_roots(root.project_id, [compact_root]))
}

pub(super) fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a GraphRunService> {
    ctx.data::<GraphRunService>().map_err(|_| unavailable())
}

fn parse_mode(value: Option<&str>) -> Result<Option<ExecutionMode>> {
    match value {
        None => Ok(None),
        Some("parallel") => Ok(Some(ExecutionMode::Parallel)),
        Some("serial") => Ok(Some(ExecutionMode::Serial)),
        Some(_) => Err(typed(
            "graph_run_invalid_mode",
            "Graph Run execution mode is invalid.",
        )),
    }
}

pub(super) fn graphql_error(error: GraphRunServiceError) -> Error {
    typed(
        error.code_str().to_owned(),
        "The Graph Run operation could not be completed.",
    )
}

fn unavailable() -> Error {
    typed("graph_run_unavailable", "Graph Run service is unavailable.")
}

fn storage_failure() -> Error {
    typed(
        "graph_run_storage_failure",
        "Graph Run storage could not be read.",
    )
}

fn typed(code: impl Into<String>, detail: &'static str) -> Error {
    let code = code.into();
    Error::new(detail).extend_with(move |_, extension| {
        extension.set("code", code);
        extension.set("detail", detail);
    })
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|id| id.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
