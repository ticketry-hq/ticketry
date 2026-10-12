//! Transport probes that answer without touching a backend.

use serde_json::json;

use super::tool_surface::{TypedTool, TypedTools};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default().with(
        TypedTool::without_parameters(
            "mcp_ping",
            "Verify MCP transport and tool execution without touching a backend.",
            |_call| async { Ok(json!({"status": "ok", "server": "ticketry"})) },
        )
        .readiness_exempt(),
    )
}
