//! Typed argument parsing that answers malformed input the way every other
//! Ticketry refusal is answered: a structured tool result, never a JSON-RPC
//! error. rmcp's stock `Parameters` extractor reports `invalid_params`, so the
//! typed path parses here instead.

use rmcp::model::JsonObject;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

/// The approved refusal code for arguments that do not parse (CODING-2726,
/// CODING-2740). Domain `CommandError` codes are rendered separately.
const VALIDATION: &str = "validation";

/// Why one tool call's arguments did not parse.
pub(crate) struct ArgumentError {
    /// The offending top-level argument, or `arguments` when none is named.
    pub(crate) field: String,
    pub(crate) detail: String,
    /// The argument is not one the tool declares; only closed tools refuse it.
    pub(crate) unknown: bool,
}

/// Deserialize a tool's arguments, or render the refusal naming the
/// offending top-level field. Unknown keys follow the parameter type's own
/// serde policy.
pub(crate) fn parse<P: DeserializeOwned>(arguments: JsonObject) -> Result<P, Value> {
    parse_arguments(arguments).map_err(|error| {
        json!({
            "ok": false,
            "detail": error.detail,
            "code": VALIDATION,
            "field": error.field,
        })
    })
}

/// Deserialize a tool's arguments for a tool that renders its own refusal.
pub(crate) fn parse_arguments<P: DeserializeOwned>(
    arguments: JsonObject,
) -> Result<P, ArgumentError> {
    serde_path_to_error::deserialize(Value::Object(arguments)).map_err(|error| {
        let detail = error.inner().to_string();
        let field = match error.path().iter().next() {
            Some(serde_path_to_error::Segment::Map { key }) => key.clone(),
            _ => missing_field(&detail).unwrap_or_else(|| "arguments".into()),
        };
        ArgumentError {
            field,
            unknown: detail.starts_with("unknown field `"),
            detail,
        }
    })
}

/// serde reports a missing field at the parent's path, naming it only in the
/// message: ``missing field `id_or_key` ``.
fn missing_field(message: &str) -> Option<String> {
    let rest = message.strip_prefix("missing field `")?;
    rest.split_once('`').map(|(field, _)| field.to_owned())
}
