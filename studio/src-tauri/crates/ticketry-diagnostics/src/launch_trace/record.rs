//! The launch-trace record as the reader consumes it.
//!
//! Records reach the reader as the JSON payloads both halves already write to
//! the development log. Parsing is total: a payload that cannot be understood
//! is reported as unparsed rather than dropped, because a missing record and a
//! malformed one are different findings.

use chrono::{DateTime, Utc};
use serde_json::Value;

/// Whether a stage admitted the launch or refused it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StageOutcome {
    /// The stage completed and the launch continued.
    Admitted,
    /// The stage refused the launch and carries a structured reason.
    Refused,
}

/// One stage record, correlated by launch attempt and Agent Run identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchTraceRecord {
    pub event: String,
    pub timestamp: DateTime<Utc>,
    pub launch_attempt_id: Option<String>,
    pub agent_run_id: Option<String>,
    pub project_id: Option<String>,
    pub provider: Option<String>,
    pub outcome: StageOutcome,
    pub refusal_reason: Option<String>,
    pub end_of_life_origin: Option<String>,
    pub exit_code: Option<i64>,
    pub terminating_signal: Option<String>,
    pub swept_run_count: Option<i64>,
}

impl LaunchTraceRecord {
    /// Reads one record from a trace payload.
    ///
    /// A payload without an event name or without a parsable timestamp is not
    /// a record; everything else is optional, because a stage that cannot know
    /// a field writes null.
    pub fn from_value(value: &Value) -> Option<Self> {
        let event = text(value, "event")?;
        let timestamp = text(value, "timestamp")?;
        let timestamp = DateTime::parse_from_rfc3339(&timestamp)
            .ok()?
            .with_timezone(&Utc);
        let refusal_reason = text(value, "refusalReason");
        let outcome = match text(value, "outcome").as_deref() {
            Some("refused") => StageOutcome::Refused,
            Some(_) | None if refusal_reason.is_some() => StageOutcome::Refused,
            _ => StageOutcome::Admitted,
        };
        Some(Self {
            event,
            timestamp,
            launch_attempt_id: text(value, "launchAttemptId"),
            agent_run_id: text(value, "agentRunId"),
            project_id: text(value, "projectId"),
            provider: text(value, "provider"),
            outcome,
            refusal_reason,
            end_of_life_origin: text(value, "endOfLifeOrigin"),
            exit_code: number(value, "exitCode"),
            terminating_signal: text(value, "terminatingSignal"),
            swept_run_count: number(value, "sweptRunCount"),
        })
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}

fn number(value: &Value, key: &str) -> Option<i64> {
    value.get(key)?.as_i64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_keeps_the_identities_and_outcome_it_carries() {
        let record = LaunchTraceRecord::from_value(&serde_json::json!({
            "event": "launch-requested",
            "timestamp": "2026-08-31T08:45:13.879Z",
            "launchAttemptId": "attempt-1",
            "agentRunId": Value::Null,
            "projectId": "project-1",
            "provider": "claude",
        }))
        .expect("a record with an event and a timestamp");

        assert_eq!(record.event, "launch-requested");
        assert_eq!(record.launch_attempt_id.as_deref(), Some("attempt-1"));
        assert_eq!(record.agent_run_id, None);
        assert_eq!(record.provider.as_deref(), Some("claude"));
        assert_eq!(record.outcome, StageOutcome::Admitted);
    }

    #[test]
    fn a_refusal_reason_makes_the_record_a_refusal() {
        let record = LaunchTraceRecord::from_value(&serde_json::json!({
            "event": "launch-argv-materialised",
            "timestamp": "2026-08-31T08:45:13.879Z",
            "refusalReason": "approved_executable_unavailable",
        }))
        .expect("a refusal record");

        assert_eq!(record.outcome, StageOutcome::Refused);
        assert_eq!(
            record.refusal_reason.as_deref(),
            Some("approved_executable_unavailable")
        );
    }

    #[test]
    fn a_payload_without_an_event_or_timestamp_is_not_a_record() {
        assert!(LaunchTraceRecord::from_value(&serde_json::json!({
            "timestamp": "2026-08-31T08:45:13.879Z"
        }))
        .is_none());
        assert!(LaunchTraceRecord::from_value(&serde_json::json!({
            "event": "launch-requested",
            "timestamp": "not a timestamp"
        }))
        .is_none());
    }
}
