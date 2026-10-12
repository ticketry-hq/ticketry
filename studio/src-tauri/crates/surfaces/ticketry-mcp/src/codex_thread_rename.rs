//! The one provider-owned MCP write: renaming a Codex thread.
//!
//! Codex keeps thread names in its own on-disk state, outside every Ticketry
//! table, so no Seaography-generated database CRUD can perform this write. The
//! tool validates its two arguments here and hands them to the one resident
//! `codex app-server` Ticketry already reads titles through. It never starts,
//! resumes, or forks a thread, and it writes no Ticketry row.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use ticketry_terminal::InstantRunTicketTitleService;

use super::tool_surface::{ArgumentError, ToolCall, TypedTool, TypedTools};

const TOOL: &str = "rename_codex_thread";

pub(super) fn typed_tools() -> TypedTools {
    // Codex owns thread names outside every Ticketry table, so this write has
    // no database scope to resolve; the authenticated tool grant is the whole
    // authorization boundary.
    TypedTools::default().with(TypedTool::with_own_results(
        TOOL,
        "Rename a Codex conversation by its Codex thread id.\n\nCodex owns thread names in its own on-disk state, so this writes through\nthe one resident ``codex app-server`` Ticketry already reads titles from.\nBoth arguments are trimmed and must be non-blank; whitespace inside the\nname is preserved and no Ticketry id or length rule applies.\n\nReturns ``{\"ok\": true, \"thread_id\", \"name\"}``. Failures return a\nstructured ``{\"ok\": false, \"error\": ..., \"detail\": ...}`` result:\n``invalid_input``, ``codex_thread_not_found``,\n``codex_app_server_unavailable``, or ``codex_app_server_error``.\n\nIt never starts, resumes, or forks a thread, and touches no Ticketry row.",
        malformed,
        |call: ToolCall, request: ThreadRename| async move {
            rename(call.codex_titles.as_ref(), &request).await
        },
    ))
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(deny_unknown_fields)]
struct ThreadRename {
    thread_id: String,
    name: String,
}

async fn rename(titles: Option<&InstantRunTicketTitleService>, request: &ThreadRename) -> Value {
    let thread_id = match trimmed("thread_id", &request.thread_id) {
        Ok(value) => value,
        Err(refusal) => return refusal,
    };
    let name = match trimmed("name", &request.name) {
        Ok(value) => value,
        Err(refusal) => return refusal,
    };
    let Some(titles) = titles else {
        return failure(
            "codex_app_server_unavailable",
            "The Codex app-server capability was not started.",
        );
    };
    match titles.rename_thread(thread_id, name).await {
        Ok(()) => json!({"ok": true, "thread_id": thread_id, "name": name}),
        Err(error) if error.is_unknown_thread() => failure(
            "codex_thread_not_found",
            "Codex does not know that thread id.",
        ),
        Err(error) if error.is_unavailable() => failure(
            "codex_app_server_unavailable",
            "The Codex app-server is not running.",
        ),
        // Provider, protocol, transport, and timeout failures collapse into one
        // code on purpose: the underlying message may name an executable path or
        // launch material, which never leaves the service.
        Err(_) => failure(
            "codex_app_server_error",
            "The Codex app-server did not complete the rename.",
        ),
    }
}

/// Trim a required string argument. Surrounding whitespace is removed and
/// whitespace inside the value is preserved; Codex owns both formats, so no
/// Ticketry identifier or length rule applies.
fn trimmed<'a>(field: &str, value: &'a str) -> Result<&'a str, Value> {
    match value.trim() {
        "" => Err(invalid_input(format!(
            "{field} must be a non-blank string."
        ))),
        value => Ok(value),
    }
}

/// Malformed arguments keep the tool's own `invalid_input` refusal rather
/// than the shared field rejection.
fn malformed(error: ArgumentError) -> Value {
    invalid_input(if error.unknown {
        format!("{} is not a {TOOL} argument.", error.field)
    } else {
        format!("{} must be a non-blank string.", error.field)
    })
}

fn invalid_input(detail: String) -> Value {
    json!({"ok": false, "error": "invalid_input", "detail": detail})
}

fn failure(error: &str, detail: &str) -> Value {
    json!({"ok": false, "error": error, "detail": detail})
}
