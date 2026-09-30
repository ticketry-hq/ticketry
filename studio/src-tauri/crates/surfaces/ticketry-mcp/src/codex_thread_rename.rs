//! The one provider-owned MCP write: renaming a Codex thread.
//!
//! Codex keeps thread names in its own on-disk state, outside every Ticketry
//! table, so no Seaography-generated database CRUD can perform this write. The
//! tool validates its two arguments here and hands them to the one resident
//! `codex app-server` Ticketry already reads titles through. It never starts,
//! resumes, or forks a thread, and it writes no Ticketry row.

use serde_json::{json, Map, Value};

use ticketry_terminal::InstantRunTicketTitleService;

pub(super) async fn rename(
    titles: Option<&InstantRunTicketTitleService>,
    arguments: &Map<String, Value>,
) -> Value {
    let thread_id = match trimmed(arguments, "thread_id") {
        Ok(value) => value,
        Err(refusal) => return refusal,
    };
    let name = match trimmed(arguments, "name") {
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
fn trimmed<'a>(arguments: &'a Map<String, Value>, field: &str) -> Result<&'a str, Value> {
    match arguments.get(field).and_then(Value::as_str).map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(json!({
            "ok": false,
            "error": "invalid_input",
            "detail": format!("{field} must be a non-blank string."),
        })),
    }
}

fn failure(error: &str, detail: &str) -> Value {
    json!({"ok": false, "error": error, "detail": detail})
}
