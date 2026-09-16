use serde_json::{json, Value};

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum Phase {
    AwaitInitialize,
    AwaitInitialized,
    Replaying,
    Ready,
    Incompatible,
}

pub struct Session {
    pub initialize: Value,
    pub initialized: Option<Vec<u8>>,
    pub protocol: Value,
    pub capabilities: Value,
}

pub enum Outstanding {
    Initialize(Value),
    Ordinary,
}

pub fn id_key(id: &Value) -> Option<String> {
    match id {
        Value::String(_) | Value::Number(_) => serde_json::to_string(id).ok(),
        _ => None,
    }
}

pub fn response_key(message: &Value) -> Option<String> {
    id_key(message.get("id")?)
}

pub fn jsonrpc_error(id: Value, code: i64, message: &str, reason: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message, "data": {"code": reason}}})
}

pub fn replay_compatible(session: &Session, response: &Value) -> bool {
    let Some(result) = response.get("result") else {
        return false;
    };
    result.get("protocolVersion") == Some(&session.protocol)
        && contains(
            &result
                .get("capabilities")
                .cloned()
                .unwrap_or_else(|| json!({})),
            &session.capabilities,
        )
}

fn contains(actual: &Value, required: &Value) -> bool {
    match (actual, required) {
        (Value::Object(actual), Value::Object(required)) => required.iter().all(|(key, value)| {
            actual
                .get(key)
                .is_some_and(|actual| contains(actual, value))
        }),
        _ => actual == required,
    }
}
