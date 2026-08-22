use std::sync::Arc;

use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    ErrorData, ServerHandler,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use crate::terminal_cleanup::TerminalCleanupService;
use crate::work_management::commands::attachments::AttachmentStorage;
use crate::work_management::launch_policy::LaunchPolicyResolver;

use super::{backend_port::BackendPort, dispatch, registry};

#[derive(Clone)]
pub struct WorktrackerMcpService {
    database: DatabaseConnection,
    storage: AttachmentStorage,
    backend: BackendPort,
    launch_policy: LaunchPolicyResolver,
    graph_runs: Option<crate::graph_run_service::GraphRunService>,
    terminal_cleanup: TerminalCleanupService,
    terminal_launch: Option<crate::terminal_launch::TerminalLaunchService>,
    /// Automatic worktree integration, when the journal it needs is installed.
    /// It is not an MCP tool and has no request path: this listener simply
    /// happens to be where committed transitions are produced, so it is also
    /// where the completions they publish are delivered.
    integrations: Option<crate::worktree_integrate::WorktreeIntegrateService>,
    tools: Arc<Vec<Tool>>,
}

impl WorktrackerMcpService {
    pub fn new(
        database: DatabaseConnection,
        storage: AttachmentStorage,
        backend: BackendPort,
        launch_policy: LaunchPolicyResolver,
        graph_runs: Option<crate::graph_run_service::GraphRunService>,
        terminal_cleanup: TerminalCleanupService,
        terminal_launch: Option<crate::terminal_launch::TerminalLaunchService>,
        integrations: Option<crate::worktree_integrate::WorktreeIntegrateService>,
    ) -> Self {
        Self {
            database,
            storage,
            backend,
            launch_policy,
            graph_runs,
            terminal_cleanup,
            terminal_launch,
            integrations,
            tools: Arc::new(registry::tools()),
        }
    }

    /// Land the checkouts whose Work Items have been completed.
    ///
    /// Delivery is bounded and idempotent, so running it beside the launch
    /// policy pass costs one indexed query when there is nothing to do. A
    /// completion committed while the listener was down is picked up by the
    /// first pass after it returns.
    pub async fn reconcile_worktree_integrations(&self) {
        let Some(integrations) = &self.integrations else {
            return;
        };
        if let Err(error) = integrations
            .deliver_pending(crate::worktree_integrate::MAX_DELIVERY_BATCH)
            .await
        {
            eprintln!("Ticketry could not deliver completed worktree integrations: {error}");
        }
    }

    fn result(output: dispatch::DispatchOutput) -> CallToolResponse {
        let structured = if output.wrap_result {
            json!({"result": output.value})
        } else {
            output.value
        };
        CallToolResult::structured(structured).into()
    }
}

pub(super) async fn execute_launch_decision(
    database: &DatabaseConnection,
    service: Option<&crate::terminal_launch::TerminalLaunchService>,
    decision: &crate::work_management::launch_policy::LaunchPolicyDecision,
) -> Result<crate::entities::terminals::session::Model, ()> {
    let Some(service) = service else {
        return Err(());
    };
    crate::work_management::launch_policy::execute_pending_decision(database, service, decision)
        .await
        .map_err(|error| {
            eprintln!(
                "Ticketry could not execute Rust launch policy decision {}: {error}",
                decision.decision_id,
            );
        })
}

impl ServerHandler for WorktrackerMcpService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(
            rmcp::model::Implementation::new("worktracker-agent", "0.1.0"),
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools.as_ref().clone()))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if self.get_tool(request.name.as_ref()).is_none() {
            return Err(ErrorData::invalid_params("Unknown WorkTracker tool.", None));
        }
        if request.name == "mcp_ping" {
            return Ok(Self::result(dispatch::DispatchOutput {
                value: json!({"status": "ok", "server": "worktracker-agent"}),
                wrap_result: false,
            }));
        }
        let (principal, _authorization) = match self.backend.authorize(&context).await {
            Ok(value) => value,
            Err(failure) => {
                return Ok(CallToolResult::structured(failure.0).into());
            }
        };
        let arguments: Map<String, Value> = request.arguments.unwrap_or_default();
        Ok(Self::result(
            dispatch::dispatch(
                &self.database,
                &self.storage,
                &self.launch_policy,
                self.graph_runs.as_ref(),
                &self.terminal_cleanup,
                self.terminal_launch.as_ref(),
                &principal,
                request.name.as_ref(),
                &arguments,
            )
            .await,
        ))
    }
}
