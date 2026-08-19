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

use crate::work_management::commands::attachments::AttachmentStorage;
use crate::work_management::launch_policy::LaunchPolicyResolver;

use super::{backend_port::BackendPort, dispatch, registry};

#[derive(Clone)]
pub struct WorktrackerMcpService {
    database: DatabaseConnection,
    storage: AttachmentStorage,
    backend: BackendPort,
    launch_policy: LaunchPolicyResolver,
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
        integrations: Option<crate::worktree_integrate::WorktreeIntegrateService>,
    ) -> Self {
        Self {
            database,
            storage,
            backend,
            launch_policy,
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

    pub async fn reconcile_launch_policy(&self) {
        if let Err(error) = crate::work_management::launch_policy::prepare_pending_auto_starts(
            &self.database,
            &self.launch_policy,
            128,
        )
        .await
        {
            eprintln!("Ticketry could not prepare auto-start policy: {error}");
            return;
        }
        // A retry the user asked for is resolved in the same pass: its pending
        // child is durable, so the launch it still owes is exactly the kind of
        // work this reconciler exists to finish.
        if let Err(error) = crate::work_management::launch_policy::prepare_pending_retries(
            &self.database,
            &self.launch_policy,
            128,
        )
        .await
        {
            eprintln!("Ticketry could not prepare Automation Attempt retries: {error}");
            return;
        }
        let decisions =
            match crate::work_management::launch_policy::pending(&self.database, 128).await {
                Ok(decisions) => decisions,
                Err(error) => {
                    eprintln!("Ticketry could not read pending launch decisions: {error}");
                    return;
                }
            };
        for decision in decisions {
            let result = self.backend.perform_launch_decision(&decision).await;
            if result.get("error").is_none() {
                if let Err(error) = crate::work_management::launch_policy::mark_delivered(
                    &self.database,
                    &decision.decision_id,
                )
                .await
                {
                    eprintln!("Ticketry could not acknowledge a launch decision: {error}");
                }
            }
        }
    }
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
        let (principal, authorization) = match self.backend.authorize(&context).await {
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
                &self.backend,
                &self.launch_policy,
                &principal,
                &authorization,
                request.name.as_ref(),
                &arguments,
            )
            .await,
        ))
    }
}
