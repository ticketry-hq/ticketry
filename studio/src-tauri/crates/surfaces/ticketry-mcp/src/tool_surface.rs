//! The one MCP tool surface every connection sees.
//!
//! Typed capability routers compose here into one ordered list. Discovery, the provider-operation inventory and
//! the provider-mutation exception check all read this list, so a tool cannot
//! be callable without being published or published without being granted.

mod argument_rejection;
mod command_rejection;
mod patch_input;
mod typed_tool;

use std::collections::BTreeSet;

use rmcp::{
    handler::server::tool::ToolCallContext,
    model::{CallToolRequestParams, CallToolResponse, Tool},
    service::RequestContext,
    ErrorData, RoleServer,
};

pub(crate) use argument_rejection::ArgumentError;
pub(crate) use command_rejection::rejection;
pub(crate) use patch_input::PatchInput;
pub(crate) use typed_tool::{ToolCall, TypedTool, TypedTools};

use super::{
    attachment_tools, codex_thread_rename, connectivity_tools, dependency_tools, launch_tools,
    read_tools, run_termination, sprint_tools, work_item_tools, workflow_policy_tools,
};

/// Tools listed ahead of the alphabetical rest, in this order.
const LEADING_TOOLS: [&str; 2] = ["mcp_ping", "terminate_current_run"];

pub(crate) struct ToolSurface {
    typed: TypedTools,
    tools: Vec<Tool>,
}

impl ToolSurface {
    /// Compose every capability's typed tools.
    pub(crate) fn build() -> Result<Self, String> {
        let mut typed = connectivity_tools::typed_tools();
        typed.merge(read_tools::typed_tools());
        typed.merge(work_item_tools::typed_tools());
        typed.merge(workflow_policy_tools::typed_tools());
        typed.merge(dependency_tools::typed_tools());
        typed.merge(attachment_tools::typed_tools());
        typed.merge(launch_tools::typed_tools());
        typed.merge(run_termination::typed_tools());
        typed.merge(sprint_tools::typed_tools());
        typed.merge(codex_thread_rename::typed_tools());
        Self::compose(typed)
    }

    fn compose(typed: TypedTools) -> Result<Self, String> {
        let mut tools: Vec<Tool> = typed.router.list_all();
        let untyped: BTreeSet<&str> = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .filter(|name| !typed.definitions.contains(*name))
            .collect();
        if !untyped.is_empty() {
            return Err(format!(
                "WorkTracker MCP tool surface refuses tools without a typed definition: {}.",
                untyped.into_iter().collect::<Vec<_>>().join(", ")
            ));
        }
        let mut seen = BTreeSet::new();
        let duplicates: BTreeSet<&str> = typed
            .duplicates
            .iter()
            .map(AsRef::as_ref)
            .chain(
                tools
                    .iter()
                    .map(|tool| tool.name.as_ref())
                    .filter(|name| !seen.insert(*name)),
            )
            .collect();
        if !duplicates.is_empty() {
            return Err(format!(
                "WorkTracker MCP tool surface publishes duplicate tool names: {}.",
                duplicates.into_iter().collect::<Vec<_>>().join(", ")
            ));
        }
        tools.sort_by_key(|tool| {
            let leading = LEADING_TOOLS
                .iter()
                .position(|name| *name == tool.name)
                .unwrap_or(LEADING_TOOLS.len());
            (leading, tool.name.clone())
        });
        Ok(Self { typed, tools })
    }

    pub(crate) fn tools(&self) -> &[Tool] {
        &self.tools
    }

    pub(crate) fn get(&self, name: &str) -> Option<&Tool> {
        self.tools.iter().find(|tool| tool.name == name)
    }

    pub(crate) fn is_run_only(&self, name: &str) -> bool {
        self.typed.run_only.contains(name)
    }

    pub(crate) fn is_readiness_exempt(&self, name: &str) -> bool {
        self.typed.readiness_exempt.contains(name)
    }

    /// Parse and run one typed tool. The caller has already authorized the
    /// call and applied the readiness gate.
    pub(crate) async fn call_typed(
        &self,
        call: ToolCall,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        self.typed
            .router
            .call(ToolCallContext::new(&call, request, context))
            .await
    }
}

/// Every published tool, in published order.
pub(crate) fn published_tools() -> Vec<Tool> {
    ToolSurface::build()
        .unwrap_or_else(|error| panic!("{error}"))
        .tools
}

/// Every operation a launched run's grant may name.
pub fn allowed_provider_operations() -> Vec<String> {
    published_tools()
        .into_iter()
        .map(|tool| tool.name.into_owned())
        .chain(std::iter::once("provider_lifecycle".to_owned()))
        .collect()
}

#[cfg(test)]
mod tests;
