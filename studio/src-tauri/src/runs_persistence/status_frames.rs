//! The receive-only frames published by the project status subscription.
//!
//! The union is the public contract: a client can only observe an
//! authoritative snapshot, a durable event, the caught-up cursor, a reset
//! requirement, or a terminal failure. Stored payloads are re-published as the
//! `Json` scalar, so retained rows never serialize an internal Rust struct.

use seaography::{
    async_graphql::dynamic::{FieldValue, TypeRef},
    BuilderContext, CustomOutputType,
};
use serde::Serialize;

use super::{AgentRunHolding, AutomationAttemptProjection, StatusEventRecord};

/// The event payload schema this build understands. A retained row with a
/// higher version is a structured failure rather than a silently reshaped
/// frame.
pub const SUPPORTED_PAYLOAD_VERSION: i32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StatusEventPayload(pub serde_json::Value);

impl CustomOutputType for StatusEventPayload {
    fn gql_output_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::named_nn("Json")
    }

    fn gql_field_value(self, _ctx: &'static BuilderContext) -> Option<FieldValue<'static>> {
        seaography::async_graphql::Value::from_json(self.0)
            .ok()
            .map(FieldValue::value)
    }
}

/// The authoritative holdings at the captured high-water cursor. A client that
/// installs this baseline has the same view as a fresh snapshot query.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct RunStatusSnapshot {
    pub project_id: String,
    pub cursor: i64,
    pub at: String,
    pub runs: Vec<AgentRunHolding>,
    pub automation_attempts: Vec<AutomationAttemptProjection>,
}

/// One durable outbox row. The cursor is global and signed; gaps belonging to
/// other projects are expected and valid.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct RunStatusEvent {
    pub cursor: i64,
    pub event_id: String,
    pub project_id: String,
    pub event_kind: String,
    pub payload_version: i32,
    pub subject_kind: String,
    pub subject_id: String,
    pub agent_run_id: Option<String>,
    pub automation_attempt_id: Option<String>,
    pub work_item_id: Option<String>,
    pub payload: StatusEventPayload,
    pub committed_at: String,
}

/// Replay is complete through this cursor. Everything after it is live.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct RunStatusCaughtUp {
    pub project_id: String,
    pub cursor: i64,
}

/// The retained cursor cannot be honoured. The client refreshes its canonical
/// holdings, installs `cursor`, and only then applies buffered frames above it.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct RunStatusResetRequired {
    pub project_id: String,
    pub cursor: i64,
    pub reason: String,
}

/// A terminal, structured outcome. It never carries database details, local
/// paths, credentials, prompts, or terminal command lines.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct RunStatusFailed {
    pub code: String,
    pub message: String,
}

/// The typed receive-only union. Variant identities are the GraphQL member
/// type names, so a client discriminates on `__typename` alone.
#[derive(Clone, Debug, PartialEq, CustomOutputType)]
pub enum RunStatusFrame {
    RunStatusSnapshot(RunStatusSnapshot),
    RunStatusEvent(RunStatusEvent),
    RunStatusCaughtUp(RunStatusCaughtUp),
    RunStatusResetRequired(RunStatusResetRequired),
    RunStatusFailed(RunStatusFailed),
}

/// Reasons a retained cursor cannot be replayed. They are part of the public
/// contract, so they stay stable strings rather than formatted prose.
pub mod reset_reason {
    pub const COMPACTED: &str = "cursor_compacted";
    pub const AHEAD_OF_SERVER: &str = "cursor_ahead_of_server";
    pub const REPLAY_BOUNDED: &str = "replay_bounded";
    /// Retained history this build cannot read is a reset, not a failure: the
    /// client can still refetch its canonical holdings and resume from the
    /// server's high-water cursor. A terminal failure would leave it stalled
    /// against history that will never become readable.
    pub const EVENT_VERSION_INCOMPATIBLE: &str = "event_version_incompatible";
}

/// Terminal failure codes. They match the structured error vocabulary the rest
/// of the Runs surface already publishes.
pub mod failure_code {
    pub const BAD_REQUEST: &str = "status_stream_bad_request";
    pub const UNAVAILABLE: &str = "runs_unavailable";
    pub const STORAGE: &str = "runs_storage_failed";
    pub const INVALID_HISTORY: &str = "runs_history_invalid";
    pub const EVENT_VERSION: &str = "status_event_version_unsupported";
}

impl RunStatusEvent {
    /// Project one retained row. An unreadable payload is history corruption,
    /// not a frame, so it is reported by the caller as a structured failure.
    pub(crate) fn from_record(record: StatusEventRecord, public_project_id: &str) -> Option<Self> {
        let payload = serde_json::from_str(&record.payload).ok()?;
        Some(Self {
            cursor: record.cursor,
            event_id: record.event_id,
            project_id: public_project_id.to_owned(),
            event_kind: record.event_kind,
            payload_version: record.payload_version,
            subject_kind: record.subject_kind,
            subject_id: record.subject_id,
            agent_run_id: record.agent_run_id,
            automation_attempt_id: record.automation_attempt_id,
            work_item_id: record.work_item_id,
            payload: StatusEventPayload(payload),
            committed_at: record.committed_at,
        })
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<RunStatusSnapshot>();
    builder.register_custom_output::<RunStatusEvent>();
    builder.register_custom_output::<RunStatusCaughtUp>();
    builder.register_custom_output::<RunStatusResetRequired>();
    builder.register_custom_output::<RunStatusFailed>();
    builder.register_custom_union::<RunStatusFrame>();
    builder
}
