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
use serde_json::json;

use ticketry_terminal::TerminalCleanupService;
use ticketry_work_management::commands::attachments::AttachmentStorage;
use ticketry_work_management::launch_policy::LaunchPolicyResolver;

use super::connection_handshake::ConnectionAuthorization;
use super::tool_surface::{ToolCall, ToolSurface};
use super::RunAuthority;

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
    /// The one resident Codex app-server allocation startup already shares with
    /// the GraphQL title resolver. MCP only renames through it; it never starts
    /// an app-server of its own.
    codex_titles: Option<ticketry_terminal::InstantRunTicketTitleService>,
    readiness_data_directory: PathBuf,
    surface: Arc<ToolSurface>,
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
        codex_titles: Option<ticketry_terminal::InstantRunTicketTitleService>,
        readiness_data_directory: PathBuf,
        surface: ToolSurface,
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
            codex_titles,
            readiness_data_directory,
            surface: Arc::new(surface),
        }
    }

    /// The service one admitted socket connection dispatches through.
    pub(super) fn for_connection(&self, connection: ConnectionAuthorization) -> Self {
        Self {
            connection: Some(connection),
            ..self.clone()
        }
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
        let tools = match self
            .connection
            .as_ref()
            .and_then(ConnectionAuthorization::bearer)
        {
            None => self.surface.tools().to_vec(),
            Some(authorization) => {
                let allowed = self
                    .authority
                    .allowed_operations(Some(authorization))
                    .await
                    .map_err(|_| {
                        ErrorData::internal_error("Run authorization is unavailable.", None)
                    })?;
                self.surface
                    .tools()
                    .iter()
                    .filter(|tool| allowed.contains(tool.name.as_ref()))
                    .cloned()
                    .collect()
            }
        };
        Ok(ListToolsResult::with_all_items(tools)
            .with_ttl_ms(0)
            .with_cache_scope(CacheScope::Private))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.surface.get(name).cloned()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if self.get_tool(request.name.as_ref()).is_none() {
            return Err(ErrorData::invalid_params("Unknown WorkTracker tool.", None));
        }
        let authorization = self
            .connection
            .as_ref()
            .and_then(ConnectionAuthorization::bearer);
        let principal = if authorization.is_none() && !self.surface.is_run_only(&request.name) {
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
        let call = ToolCall {
            database: self.database.clone(),
            principal,
            storage: self.storage.clone(),
            launch_policy: self.launch_policy.clone(),
            graph_runs: self.graph_runs.clone(),
            terminal_cleanup: self.terminal_cleanup.clone(),
            terminal_launch: self.terminal_launch.clone(),
            codex_titles: self.codex_titles.clone(),
        };
        if self.surface.is_readiness_exempt(&request.name) {
            return self.surface.call_typed(call, request, context).await;
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
        self.surface.call_typed(call, request, context).await
    }
}
