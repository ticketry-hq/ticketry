#![allow(non_snake_case)]

//! Restricted Graph Run CRUD override.
//!
//! Override record:
//! Generated create-one cannot derive Project, Module, local caller, policy,
//! timestamps, and crash-safe launch effects. Create-batch cannot safely fan
//! out those effects. Seaography rc.9 update_many skips pre-save hooks, and
//! delete_many has no lifecycle hook for serialized reset. GraphQL aliases,
//! column codecs, skips, guards, filters, database defaults, and SeaORM row
//! hooks cannot add the cross-row transaction or external-effect preparation.
//! The smallest safe contract is one non-null root identity plus an optional
//! execution mode. GraphRunService owns the SeaORM transactions and returns the
//! authoritative Graph Run with only the child Work Item identities accepted
//! by this request. Generated create-one, create-batch, update, and delete all
//! remain private. Contract tests pin the SDL, scope, protected fields, result,
//! and the exact entries in operation_registry.

use sea_orm::{DatabaseConnection, EntityTrait};
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomOutputType,
};

use crate::entities::{execution::graph_run, work_management::issue};
use crate::execution::graph::{ExecutionMode, GraphAccess};
use crate::work_management::read_types::StringList;

use super::{
    DeletedGraphRunResult, GraphRunCaller, GraphRunRequest, GraphRunResult, GraphRunService,
    GraphRunServiceError,
};

#[derive(Clone, Debug, PartialEq, Eq, CustomOutputType)]
pub struct GraphRunMutationPayload {
    pub graph_run: graph_run::Model,
    pub prepared_child_ids: StringList,
}

#[derive(Clone, Debug, PartialEq, Eq, CustomOutputType)]
pub struct GraphRunDeletePayload {
    pub graph_run: graph_run::Model,
    pub cleared_child_ids: StringList,
}

impl From<GraphRunResult> for GraphRunMutationPayload {
    fn from(result: GraphRunResult) -> Self {
        Self {
            graph_run: result.graph_run,
            prepared_child_ids: StringList(
                result
                    .launched
                    .into_iter()
                    .map(|child| public_id(&child.task_id))
                    .collect(),
            ),
        }
    }
}

impl From<DeletedGraphRunResult> for GraphRunDeletePayload {
    fn from(result: DeletedGraphRunResult) -> Self {
        Self {
            graph_run: result.graph_run,
            cleared_child_ids: StringList(
                result
                    .cleared_task_ids
                    .into_iter()
                    .map(|id| public_id(&id))
                    .collect(),
            ),
        }
    }
}

pub struct GraphRunMutations;

#[CustomFields]
impl GraphRunMutations {
    async fn graph_run_create(
        ctx: &Context<'_>,
        root_id: String,
        execution_mode: Option<String>,
    ) -> Result<GraphRunMutationPayload> {
        let request = request(ctx, &root_id, execution_mode).await?;
        service(ctx)?
            .create(request)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }

    async fn graph_run_update(
        ctx: &Context<'_>,
        root_id: String,
        execution_mode: Option<String>,
    ) -> Result<GraphRunMutationPayload> {
        let request = request(ctx, &root_id, execution_mode).await?;
        service(ctx)?
            .update(request)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }

    async fn graph_run_delete(ctx: &Context<'_>, root_id: String) -> Result<GraphRunDeletePayload> {
        let access = caller_access(ctx, &root_id).await?;
        service(ctx)?
            .delete(&root_id, &access)
            .await
            .map(Into::into)
            .map_err(graphql_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    debug_assert_eq!(
        super::operation_registry::RESTRICTED_MUTATIONS
            .iter()
            .map(|entry| entry.field)
            .collect::<Vec<_>>(),
        ["graph_run_create", "graph_run_update", "graph_run_delete"]
    );
    debug_assert!(super::operation_registry::RESTRICTED_MUTATIONS
        .iter()
        .all(|entry| !entry.generated_gap.is_empty()
            && !entry.identity_scope.is_empty()
            && !entry.implementation.is_empty()
            && !entry.safety_test.is_empty()));
    builder.register_custom_output::<GraphRunMutationPayload>();
    builder.register_custom_output::<GraphRunDeletePayload>();
    builder.register_custom_mutation::<GraphRunMutations>();
    builder
}

async fn request(
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

async fn caller_access(ctx: &Context<'_>, root_id: &str) -> Result<GraphAccess> {
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

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a GraphRunService> {
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

fn graphql_error(error: GraphRunServiceError) -> Error {
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

fn public_id(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|id| id.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDateTime;

    use super::*;
    use crate::graph_run_service::{GraphRunServiceErrorCode, LaunchedChild};

    fn model() -> graph_run::Model {
        graph_run::Model {
            root_id: "40000000000000000000000000000001".into(),
            agent: Some("codex".into()),
            created_at: NaiveDateTime::default(),
            updated_at: NaiveDateTime::default(),
            module_id: Some("20000000000000000000000000000001".into()),
            project_id: "10000000000000000000000000000001".into(),
            execution_mode: "parallel".into(),
            launch_configuration: Some("secret prompt and required skills".into()),
        }
    }

    #[test]
    fn result_keeps_only_authoritative_model_and_prepared_child_identities() {
        let payload = GraphRunMutationPayload::from(GraphRunResult {
            graph_run: model(),
            launched: vec![LaunchedChild {
                task_id: "50000000000000000000000000000001".into(),
                agent_run_id: "private-agent-run".into(),
                provider: "private-provider-material".into(),
            }],
        });
        assert_eq!(
            payload.prepared_child_ids.0,
            ["50000000-0000-0000-0000-000000000001"]
        );
    }

    #[test]
    fn public_errors_discard_private_service_details() {
        let error = GraphRunServiceError::new(
            GraphRunServiceErrorCode::Storage,
            "graph_run_storage_failure",
            "secret prompt /Users/private command tmux-session raw-provider-output",
        );
        let public = graphql_error(error);
        assert_eq!(
            public.message,
            "The Graph Run operation could not be completed."
        );
        assert!(!format!("{public:?}").contains("/Users/private"));
        assert!(!format!("{public:?}").contains("tmux-session"));
    }

    #[test]
    fn generated_contract_pins_the_restricted_mutation_bundle() {
        let sdl = include_str!("../../../src/graphql-foundation/generated/schema.graphql");
        let graph_run = sdl
            .split("type GraphRuns {")
            .nth(1)
            .unwrap()
            .split("}\n")
            .next()
            .unwrap();
        assert!(graph_run.contains("rootId: String!"));
        assert!(graph_run.contains("root: WorktrackerIssue"));
        assert!(graph_run.contains("project: WorktrackerProject"));
        for protected in [
            "launchConfiguration",
            "launchClaims",
            "agentRunId",
            "launchEffectId",
            "prompt",
            "path",
            "command",
            "tmux",
            "runtime",
        ] {
            assert!(!graph_run.contains(protected), "leaked {protected}");
        }
        assert!(sdl.contains("graph_run_create(root_id: String!, execution_mode: String)"));
        assert!(sdl.contains("graph_run_update(root_id: String!, execution_mode: String)"));
        assert!(sdl.contains("graph_run_delete(root_id: String!)"));
        assert!(!sdl.contains("graphRunsCreateOne"));
        assert!(!sdl.contains("graphRunsCreateBatch"));
        assert!(!sdl.contains("graphRunsUpdate"));
        assert!(!sdl.contains("graphRunsDelete"));
        assert!(!sdl.contains("type LaunchedTasks"));
    }
}
