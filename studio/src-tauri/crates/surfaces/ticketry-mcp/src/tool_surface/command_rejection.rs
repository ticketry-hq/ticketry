//! The structured rejection every MCP tool answers with.

use serde_json::{json, Value};

use ticketry_work_management::commands::CommandError;

pub(crate) fn rejection(error: &CommandError) -> Value {
    let mut body = json!({"ok": false, "detail": error.to_string(), "code": error.code()});
    if let Some(field) = error.field_name() {
        body["field"] = Value::String(field.to_owned());
    }
    if let Some(from) = error.from_state() {
        body["from"] = Value::String(from.to_owned());
    }
    if let Some(to) = error.to_state() {
        body["to"] = Value::String(to.to_owned());
    }
    body
}
