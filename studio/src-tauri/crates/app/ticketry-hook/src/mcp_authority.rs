use std::io;

use serde_json::{json, Value};

use crate::cli::McpMode;

pub fn handshake(mode: McpMode) -> io::Result<Value> {
    match mode {
        McpMode::Global => Ok(json!({"ticketry_mcp_auth": 1, "mode": "global"})),
        McpMode::Run { agent_run_id } => {
            let authorization = std::env::var("TICKETRY_MCP_AUTHORIZATION")
                .ok()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "TICKETRY_MCP_AUTHORIZATION is required",
                    )
                })?;
            Ok(json!({
                "ticketry_mcp_auth": 1,
                "mode": "run",
                "agent_run_id": agent_run_id,
                "authorization": authorization,
            }))
        }
    }
}
