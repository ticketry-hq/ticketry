use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};
use std::sync::LazyLock;

static RUNTIME_INSTANCE: LazyLock<String> =
    LazyLock::new(|| uuid::Uuid::new_v4().simple().to_string());

pub fn runtime_instance() -> &'static str {
    RUNTIME_INSTANCE.as_str()
}

pub fn record(record: LaunchDiscoveryRecord) {
    let log = super::file_log::process_file_log();
    if !log.is_enabled() {
        return;
    }
    if let Err(error) = log.record("backend", "info", "launch-discovery", record.into_value()) {
        eprintln!("Ticketry could not append launch-discovery diagnostics: {error}");
    }
}

pub struct LaunchDiscoveryRecord {
    fields: Map<String, Value>,
}

impl LaunchDiscoveryRecord {
    pub fn new(
        event: &str,
        runtime_instance: &str,
        project_id: Option<&str>,
        agent_run_id: Option<&str>,
        cursor: Option<i64>,
        connection_generation: Option<u64>,
        renderer_instance: Option<&str>,
    ) -> Self {
        let mut fields = Map::new();
        fields.insert("event".to_owned(), Value::String(event.to_owned()));
        fields.insert(
            "timestamp".to_owned(),
            Value::String(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)),
        );
        fields.insert("projectId".to_owned(), optional_string(project_id));
        fields.insert("agentRunId".to_owned(), optional_string(agent_run_id));
        fields.insert("cursor".to_owned(), cursor.into());
        fields.insert(
            "connectionGeneration".to_owned(),
            connection_generation.into(),
        );
        fields.insert(
            "rendererInstance".to_owned(),
            optional_string(renderer_instance),
        );
        fields.insert(
            "runtimeInstance".to_owned(),
            Value::String(runtime_instance.to_owned()),
        );
        Self { fields }
    }

    pub fn with_detail(mut self, key: &str, value: Value) -> Self {
        self.fields.insert(key.to_owned(), value);
        self
    }

    pub fn into_value(self) -> Value {
        Value::Object(self.fields)
    }
}

fn optional_string(value: Option<&str>) -> Value {
    value.map_or(Value::Null, |value| Value::String(value.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_records_keep_the_complete_correlation_identity() {
        let record = LaunchDiscoveryRecord::new(
            "wake-up-received",
            "runtime-1",
            Some("project-1"),
            Some("run-1"),
            Some(42),
            Some(3),
            Some("renderer-1"),
        )
        .with_detail("deliveryPath", serde_json::json!("wake_up"));
        let value = record.into_value();

        for field in [
            "event",
            "timestamp",
            "projectId",
            "agentRunId",
            "cursor",
            "connectionGeneration",
            "rendererInstance",
            "runtimeInstance",
        ] {
            assert!(value.get(field).is_some(), "missing {field}: {value}");
        }
        assert_eq!(value["deliveryPath"], "wake_up");
    }
}
