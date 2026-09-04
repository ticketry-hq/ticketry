//! Emitting one launch-path stage record.
//!
//! Probes observe and never decide. A probe cannot gate a launch, retry, or
//! change its outcome; a probe that cannot emit is skipped. No probe records
//! prompt text, credentials, environment values, or raw argv, so a trace stays
//! safe to attach to a Work Item.

use crate::{record_launch_discovery, runtime_instance, LaunchDiscoveryRecord};
use serde_json::Value;

use super::attempt::{current, LaunchAttempt};

/// A stage record under construction.
pub struct StageProbe {
    event: &'static str,
    agent_run_id: Option<String>,
    refusal_reason: Option<String>,
    details: Vec<(String, Value)>,
}

/// Records that `event` completed and the launch continued.
pub fn admitted(event: &'static str) -> StageProbe {
    StageProbe {
        event,
        agent_run_id: None,
        refusal_reason: None,
        details: Vec::new(),
    }
}

/// Records that `event` refused the launch, and why.
///
/// A refusing stage must say so: silence is never the only signal of failure.
pub fn refused(event: &'static str, reason: impl Into<String>) -> StageProbe {
    StageProbe {
        event,
        agent_run_id: None,
        refusal_reason: Some(reason.into()),
        details: Vec::new(),
    }
}

/// Records the commit: the one record carrying both the attempt identity and
/// the Agent Run identity it produced, which joins the two halves of the trace.
pub fn attempt_committed(agent_run_id: &str) {
    committed(agent_run_id).record();
}

pub(crate) fn committed(agent_run_id: &str) -> StageProbe {
    StageProbe {
        event: "launch-attempt-committed",
        agent_run_id: Some(agent_run_id.to_owned()),
        refusal_reason: None,
        details: Vec::new(),
    }
}

/// Records `event` as admitted or refused, whichever the outcome was.
///
/// Useful where one probe reports both outcomes with the same detail fields.
pub fn stage(event: &'static str, refusal: Option<impl Into<String>>) -> StageProbe {
    match refusal {
        Some(reason) => refused(event, reason),
        None => admitted(event),
    }
}

impl StageProbe {
    /// Adds one detail field. Values must describe shape, never content.
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.details.push((key.to_owned(), value.into()));
        self
    }

    /// Adds one detail field, writing null when the stage cannot know it.
    pub fn with_optional(self, key: &str, value: Option<impl Into<Value>>) -> Self {
        match value {
            Some(value) => self.with(key, value),
            None => self.with(key, Value::Null),
        }
    }

    /// Writes the record. Without a current attempt there is nothing to
    /// correlate against, so the probe is skipped rather than emitting an
    /// unkeyed record.
    pub fn record(self) {
        let Some(attempt) = current() else {
            return;
        };
        record_launch_discovery(self.build(&attempt));
    }

    /// Builds the record this probe would write. Separated from writing so the
    /// record contract can be asserted without a running application.
    pub(crate) fn build(self, attempt: &LaunchAttempt) -> LaunchDiscoveryRecord {
        let facts = attempt.facts();
        let mut record = LaunchDiscoveryRecord::new(
            self.event,
            runtime_instance(),
            facts.project_id.as_deref(),
            self.agent_run_id.as_deref(),
            None,
            None,
            None,
        )
        .with_detail("launchAttemptId", Value::String(attempt.id().to_owned()))
        .with_detail(
            "launchSurface",
            Value::String(attempt.surface().recorded_name().to_owned()),
        )
        .with_detail("provider", optional(facts.provider))
        .with_detail("model", optional(facts.model))
        .with_detail("reasoning", optional(facts.reasoning))
        .with_detail("scope", optional(facts.scope))
        .with_detail("workItemId", optional(facts.work_item_id))
        .with_detail(
            "outcome",
            Value::String(
                if self.refusal_reason.is_some() {
                    "refused"
                } else {
                    "admitted"
                }
                .to_owned(),
            ),
        )
        .with_detail("refusalReason", optional(self.refusal_reason));
        for (key, value) in self.details {
            record = record.with_detail(&key, value);
        }
        record
    }
}

fn optional(value: Option<String>) -> Value {
    value.map_or(Value::Null, Value::String)
}
