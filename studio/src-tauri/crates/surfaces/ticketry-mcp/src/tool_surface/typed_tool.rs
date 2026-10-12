//! A Ticketry tool defined once: typed parameters, one handler and its
//! description. The published schema derives from the parameter type, and the
//! handler only runs after the shared path has authorized the call, applied
//! the readiness gate and parsed the arguments.

use std::{borrow::Cow, collections::BTreeSet, future::Future, pin::Pin, sync::Arc};

use rmcp::{
    handler::server::tool::{schema_for_input, ToolCallContext, ToolRoute},
    model::{CallToolResult, JsonObject, Tool},
    schemars::JsonSchema,
};
use sea_orm::DatabaseConnection;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use ticketry_agent_execution::GraphRunService;
use ticketry_terminal::{
    InstantRunTicketTitleService, TerminalCleanupService, TerminalLaunchService,
};
use ticketry_work_management::commands::{attachments::AttachmentStorage, CommandError};
use ticketry_work_management::launch_policy::LaunchPolicyResolver;

use super::super::RunPrincipal;
use super::argument_rejection::{self, ArgumentError};
use super::command_rejection::rejection;

/// What one authorized, admitted tool call may reach.
#[derive(Clone)]
pub(crate) struct ToolCall {
    pub(crate) database: DatabaseConnection,
    pub(crate) principal: RunPrincipal,
    pub(crate) storage: AttachmentStorage,
    pub(crate) launch_policy: LaunchPolicyResolver,
    pub(crate) graph_runs: Option<GraphRunService>,
    pub(crate) terminal_cleanup: TerminalCleanupService,
    pub(crate) terminal_launch: Option<TerminalLaunchService>,
    pub(crate) codex_titles: Option<InstantRunTicketTitleService>,
}

/// Typed tool definitions for one capability module, composed into the one
/// tool surface.
#[derive(Default)]
pub(crate) struct TypedTools {
    pub(super) router: rmcp::handler::server::tool::ToolRouter<ToolCall>,
    /// Names declared through [`TypedTool`]; composition refuses any other
    /// route.
    pub(super) definitions: BTreeSet<Cow<'static, str>>,
    pub(super) run_only: BTreeSet<Cow<'static, str>>,
    pub(super) readiness_exempt: BTreeSet<Cow<'static, str>>,
    /// Names published more than once; composition refuses them.
    pub(super) duplicates: Vec<Cow<'static, str>>,
}

type Answer = Pin<Box<dyn Future<Output = CallToolResult> + Send>>;
type Handler = Arc<dyn Fn(ToolCall, JsonObject, AnswerShape) -> Answer + Send + Sync>;

/// How a handler's successful value reaches the client.
#[derive(Clone, Copy)]
enum AnswerShape {
    /// The value is the whole structured result.
    Direct,
    /// The value is published as `{"result": value}`.
    UnderResult,
}

/// The parameter type of a tool that declares no arguments. Its schema keeps
/// an explicit empty `properties`, which strict clients require of objects.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars", extend("properties" = {}))]
struct NoParameters {}

/// One typed tool before it joins a capability's [`TypedTools`].
pub(crate) struct TypedTool {
    attr: Tool,
    handler: Handler,
    shape: AnswerShape,
    run_only: bool,
    readiness_exempt: bool,
}

impl TypedTool {
    /// A tool whose arguments parse into `P`. Malformed arguments become the
    /// structured field rejection; the handler's [`CommandError`] becomes the
    /// shared structured rejection.
    pub(crate) fn new<P, H, F>(name: &'static str, description: &'static str, handler: H) -> Self
    where
        P: DeserializeOwned + JsonSchema + Send + 'static,
        H: Fn(ToolCall, P) -> F + Clone + Send + Sync + 'static,
        F: Future<Output = Result<Value, CommandError>> + Send + 'static,
    {
        Self::define::<P, _, _>(name, description, move |call, arguments, shape| {
            let handler = handler.clone();
            async move {
                match argument_rejection::parse::<P>(arguments) {
                    Ok(parameters) => respond(handler(call, parameters).await, shape),
                    Err(rejection) => CallToolResult::structured(rejection),
                }
            }
        })
    }

    /// A provider tool that answers in its own result vocabulary instead of
    /// the shared [`CommandError`] rejection: `refuse` renders malformed
    /// arguments and the handler's value is the whole structured result.
    pub(crate) fn with_own_results<P, H, F>(
        name: &'static str,
        description: &'static str,
        refuse: fn(ArgumentError) -> Value,
        handler: H,
    ) -> Self
    where
        P: DeserializeOwned + JsonSchema + Send + 'static,
        H: Fn(ToolCall, P) -> F + Clone + Send + Sync + 'static,
        F: Future<Output = Value> + Send + 'static,
    {
        Self::define::<P, _, _>(name, description, move |call, arguments, _shape| {
            let handler = handler.clone();
            async move {
                CallToolResult::structured(
                    match argument_rejection::parse_arguments::<P>(arguments) {
                        Ok(parameters) => handler(call, parameters).await,
                        Err(error) => refuse(error),
                    },
                )
            }
        })
    }

    /// A tool that takes no arguments; any supplied keys are ignored.
    pub(crate) fn without_parameters<H, F>(
        name: &'static str,
        description: &'static str,
        handler: H,
    ) -> Self
    where
        H: Fn(ToolCall) -> F + Clone + Send + Sync + 'static,
        F: Future<Output = Result<Value, CommandError>> + Send + 'static,
    {
        Self::define::<NoParameters, _, _>(name, description, move |call, _arguments, shape| {
            let handler = handler.clone();
            async move { respond(handler(call).await, shape) }
        })
    }

    /// Every constructor publishes the schema derived from `P`.
    fn define<P, H, F>(name: &'static str, description: &'static str, handler: H) -> Self
    where
        P: JsonSchema + 'static,
        H: Fn(ToolCall, JsonObject, AnswerShape) -> F + Send + Sync + 'static,
        F: Future<Output = CallToolResult> + Send + 'static,
    {
        Self {
            attr: Tool::new(name, description, input_schema::<P>(name)),
            handler: Arc::new(move |call, arguments, shape| {
                Box::pin(handler(call, arguments, shape))
            }),
            shape: AnswerShape::Direct,
            run_only: false,
            readiness_exempt: false,
        }
    }

    /// Publish each successful value as `{"result": value}`.
    pub(crate) fn answers_under_result(mut self) -> Self {
        self.shape = AnswerShape::UnderResult;
        self
    }

    /// Refuse bearer-less (global) connections with the shared run
    /// authorization refusal before the handler is reached.
    pub(crate) fn run_only(mut self) -> Self {
        self.run_only = true;
        self
    }

    /// Answer even while startup reconciliation keeps the readiness gate shut.
    pub(crate) fn readiness_exempt(mut self) -> Self {
        self.readiness_exempt = true;
        self
    }

    fn into_route(self) -> ToolRoute<ToolCall> {
        let (handler, shape) = (self.handler, self.shape);
        ToolRoute::new_dyn(self.attr, move |context: ToolCallContext<'_, ToolCall>| {
            let answer = handler(
                context.service.clone(),
                context.arguments.unwrap_or_default(),
                shape,
            );
            Box::pin(async move { Ok(answer.await.into()) })
        })
    }
}

impl TypedTools {
    pub(crate) fn with(mut self, tool: TypedTool) -> Self {
        let name = tool.attr.name.clone();
        if self.router.has_route(&name) {
            self.duplicates.push(name.clone());
        }
        self.definitions.insert(name.clone());
        if tool.run_only {
            self.run_only.insert(name.clone());
        }
        if tool.readiness_exempt {
            self.readiness_exempt.insert(name);
        }
        self.router.add_route(tool.into_route());
        self
    }

    pub(super) fn merge(&mut self, other: TypedTools) {
        for route in other.router.map.values() {
            if self.router.has_route(&route.attr.name) {
                self.duplicates.push(route.attr.name.clone());
            }
        }
        self.duplicates.extend(other.duplicates);
        self.definitions.extend(other.definitions);
        self.run_only.extend(other.run_only);
        self.readiness_exempt.extend(other.readiness_exempt);
        self.router.merge(other.router);
    }
}

/// The published input schema, derived from the parameter type.
fn input_schema<P: JsonSchema + 'static>(name: &str) -> Arc<JsonObject> {
    schema_for_input::<P>()
        .map(|schema| {
            let mut schema = schema.as_ref().clone();
            // The published surface never carried a dialect marker.
            schema.remove("$schema");
            Arc::new(schema)
        })
        .unwrap_or_else(|error| panic!("invalid input schema for MCP tool {name}: {error}"))
}

fn respond(output: Result<Value, CommandError>, shape: AnswerShape) -> CallToolResult {
    CallToolResult::structured(match (output, shape) {
        (Ok(value), AnswerShape::UnderResult) => json!({"result": value}),
        (Ok(value), AnswerShape::Direct) => value,
        (Err(error), _) => rejection(&error),
    })
}
