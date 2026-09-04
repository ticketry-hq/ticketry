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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchRequestSurface {
    StudioLaunchPicker,
    RunNow,
    DefaultCodingAgent,
    DependencyGraph,
    WorkflowAutoStart,
}

impl LaunchRequestSurface {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StudioLaunchPicker => "studio-launch-picker",
            Self::RunNow => "run-now",
            Self::DefaultCodingAgent => "default-coding-agent",
            Self::DependencyGraph => "dependency-graph",
            Self::WorkflowAutoStart => "workflow-auto-start",
        }
    }
}

pub struct LaunchRequestedRecord<'a> {
    pub launch_attempt_id: &'a str,
    pub surface: LaunchRequestSurface,
    pub project_id: Option<&'a str>,
    pub work_item_id: Option<&'a str>,
    pub provider_slug: Option<&'a str>,
    pub model: Option<&'a str>,
    pub reasoning_level: Option<&'a str>,
    pub scope: Option<&'a str>,
}

impl LaunchRequestedRecord<'_> {
    pub fn record(self) {
        record(self.into_record(runtime_instance()));
    }

    fn into_record(self, runtime_instance: &str) -> LaunchDiscoveryRecord {
        let current_attempt = crate::launch_trace::current();
        let launch_attempt_id = current_attempt
            .as_ref()
            .map_or(self.launch_attempt_id, |attempt| attempt.id());
        LaunchDiscoveryRecord::new(
            "launch-requested",
            runtime_instance,
            self.project_id,
            None,
            None,
            None,
            None,
        )
        .with_detail("launchAttemptId", json_string(launch_attempt_id))
        .with_detail("launchSurface", json_string(self.surface.as_str()))
        .with_detail("requestedProviderSlug", optional_string(self.provider_slug))
        .with_detail("requestedModel", optional_string(self.model))
        .with_detail(
            "requestedReasoningLevel",
            optional_string(self.reasoning_level),
        )
        .with_detail("requestedScope", optional_string(self.scope))
        .with_detail("workItemId", optional_string(self.work_item_id))
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

fn json_string(value: &str) -> Value {
    Value::String(value.to_owned())
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

    #[test]
    fn launch_requests_name_each_requesting_surface_without_sensitive_material() {
        let surfaces = [
            LaunchRequestSurface::StudioLaunchPicker,
            LaunchRequestSurface::RunNow,
            LaunchRequestSurface::DefaultCodingAgent,
            LaunchRequestSurface::DependencyGraph,
            LaunchRequestSurface::WorkflowAutoStart,
        ];
        let names = surfaces.map(LaunchRequestSurface::as_str);
        assert_eq!(
            names,
            [
                "studio-launch-picker",
                "run-now",
                "default-coding-agent",
                "dependency-graph",
                "workflow-auto-start",
            ],
        );

        let value = LaunchRequestedRecord {
            launch_attempt_id: "attempt-1374",
            surface: LaunchRequestSurface::StudioLaunchPicker,
            project_id: Some("project-1"),
            work_item_id: Some("task-1"),
            provider_slug: Some("claude"),
            model: None,
            reasoning_level: None,
            scope: Some("task"),
        }
        .into_record("runtime-1")
        .into_value();

        assert_eq!(value["event"], "launch-requested");
        assert_eq!(value["launchAttemptId"], "attempt-1374");
        assert_eq!(value["launchSurface"], "studio-launch-picker");
        assert_eq!(value["requestedProviderSlug"], "claude");
        assert_eq!(value["requestedModel"], Value::Null);
        assert_eq!(value["requestedReasoningLevel"], Value::Null);
        assert_eq!(value["requestedScope"], "task");
        assert_eq!(value["workItemId"], "task-1");
        assert_eq!(value["agentRunId"], Value::Null);
        for forbidden in ["prompt", "credentials", "environment", "argv"] {
            assert!(
                value.get(forbidden).is_none(),
                "leaked {forbidden}: {value}"
            );
        }
    }

    #[tokio::test]
    async fn launch_requests_use_the_ambient_trace_attempt_identity() {
        let (trace_attempt_id, value) = crate::launch_trace::requested_by(
            crate::launch_trace::LaunchSurface::RunNow,
            async {
                let trace_attempt_id = crate::launch_trace::current()
                    .expect("a launch attempt inside the request scope")
                    .id()
                    .to_owned();
                let value = LaunchRequestedRecord {
                    launch_attempt_id: "supplied-client-request-id",
                    surface: LaunchRequestSurface::RunNow,
                    project_id: Some("project-1"),
                    work_item_id: Some("task-1"),
                    provider_slug: Some("codex"),
                    model: None,
                    reasoning_level: None,
                    scope: Some("task"),
                }
                .into_record("runtime-1")
                .into_value();
                (trace_attempt_id, value)
            },
        )
        .await;

        assert_eq!(value["launchAttemptId"], trace_attempt_id);
    }
}
