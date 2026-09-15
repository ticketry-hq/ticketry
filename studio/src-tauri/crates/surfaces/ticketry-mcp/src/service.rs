use std::{path::PathBuf, sync::Arc};

use rmcp::{
    model::{
        CacheScope, CallToolRequestParams, CallToolResponse, CallToolResult, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    ErrorData, ServerHandler,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use ticketry_terminal::TerminalCleanupService;
use ticketry_work_management::commands::attachments::AttachmentStorage;
use ticketry_work_management::launch_policy::LaunchPolicyResolver;

use super::connection_handshake::ConnectionAuthorization;
use super::{dispatch, registry, RunAuthority};

#[derive(Clone)]
pub struct WorktrackerMcpService {
    /// Who this connection was admitted as. `None` only on the shared
    /// prototype the listener clones from; every served connection carries
    /// its own value.
    connection: Option<ConnectionAuthorization>,
    database: DatabaseConnection,
    storage: AttachmentStorage,
    authority: RunAuthority,
    launch_policy: LaunchPolicyResolver,
    graph_runs: Option<ticketry_agent_execution::GraphRunService>,
    terminal_cleanup: TerminalCleanupService,
    terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
    readiness_data_directory: PathBuf,
    tools: Arc<Vec<Tool>>,
}

impl WorktrackerMcpService {
    pub fn new(
        database: DatabaseConnection,
        storage: AttachmentStorage,
        authority: RunAuthority,
        launch_policy: LaunchPolicyResolver,
        graph_runs: Option<ticketry_agent_execution::GraphRunService>,
        terminal_cleanup: TerminalCleanupService,
        terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
        readiness_data_directory: PathBuf,
    ) -> Self {
        Self {
            connection: None,
            database,
            storage,
            authority,
            launch_policy,
            graph_runs,
            terminal_cleanup,
            terminal_launch,
            readiness_data_directory,
            tools: Arc::new(registry::tools()),
        }
    }

    /// The service one admitted socket connection dispatches through.
    pub(super) fn for_connection(&self, connection: ConnectionAuthorization) -> Self {
        Self {
            connection: Some(connection),
            ..self.clone()
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
    service: Option<&ticketry_terminal::TerminalLaunchService>,
    cleanup: &TerminalCleanupService,
    decision: &ticketry_work_management::launch_policy::LaunchPolicyDecision,
) -> Result<ticketry_entities::session::Model, String> {
    let Some(service) = service else {
        return Err("terminal_launch_unavailable".to_owned());
    };
    ticketry_agent_execution::launch_delivery::execute(database, service, cleanup, decision)
        .await
        .map_err(|error| {
            eprintln!(
                "Ticketry could not execute Rust launch policy decision {}: {error}",
                decision.decision_id,
            );
            error
        })
}

impl ServerHandler for WorktrackerMcpService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new("ticketry", "0.1.0"))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools.as_ref().clone())
            .with_ttl_ms(0)
            .with_cache_scope(CacheScope::Private))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if self.get_tool(request.name.as_ref()).is_none() {
            return Err(ErrorData::invalid_params("Unknown WorkTracker tool.", None));
        }
        let authorization = self
            .connection
            .as_ref()
            .and_then(ConnectionAuthorization::bearer);
        let principal = if authorization.is_none() && request.name != "terminate_current_run" {
            super::RunPrincipal::global()
        } else {
            match self
                .authority
                .authorize(authorization, request.name.as_ref())
                .await
            {
                Ok(value) => value,
                Err(failure) => {
                    return Ok(CallToolResult::structured(failure.0).into());
                }
            }
        };
        let arguments: Map<String, Value> = request.arguments.unwrap_or_default();
        if request.name == "mcp_ping" {
            return Ok(Self::result(dispatch::DispatchOutput {
                value: json!({"status": "ok", "server": "ticketry"}),
                wrap_result: false,
            }));
        }
        let readiness_file = self.readiness_data_directory.join("slice2-readiness.json");
        if readiness_file.exists()
            && !ticketry_settings::published_readiness_is_complete(&self.readiness_data_directory)
        {
            return Ok(CallToolResult::structured(json!({
                "ok": false,
                "code": "service_unavailable",
                "phase": "runtime-reconciliation",
                "detail": "Ticketry startup has not finished runtime reconciliation.",
                "remedy": "Retry after Ticketry reports that Studio is ready."
            }))
            .into());
        }
        // Dispatch is one very wide future (every tool's arm is inlined into
        // it). Boxing it keeps the per-request poll off the connection task's
        // stack frame chain.
        let output = Box::pin(dispatch::dispatch(
            &self.database,
            &self.storage,
            &self.launch_policy,
            self.graph_runs.as_ref(),
            &self.terminal_cleanup,
            self.terminal_launch.as_ref(),
            &principal,
            request.name.as_ref(),
            &arguments,
        ))
        .await;
        Ok(Self::result(output))
    }
}
