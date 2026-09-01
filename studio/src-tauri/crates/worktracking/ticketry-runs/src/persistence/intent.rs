use std::collections::BTreeSet;

use serde_json::Value;

use super::{RunsPersistenceError, RunsPersistenceErrorCode};

const ALLOWED_FIELDS: [&str; 11] = [
    "effectId",
    "agentRunId",
    "automationAttemptId",
    "requestId",
    "projectId",
    "issueId",
    "scope",
    "provider",
    "targetKind",
    "targetId",
    "policyReference",
];

/// Immutable, normalized launch data. It deliberately has no command,
/// executable, environment, prompt, credential, or token field.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchIntent {
    pub effect_id: String,
    pub agent_run_id: String,
    pub automation_attempt_id: Option<String>,
    pub request_id: String,
    pub project_id: String,
    pub issue_id: String,
    pub scope: String,
    pub provider: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    pub policy_reference: Option<String>,
}

impl LaunchIntent {
    pub fn from_json(value: &Value) -> Result<Self, RunsPersistenceError> {
        let object = value
            .as_object()
            .ok_or_else(|| invalid("launch intent must be an object"))?;
        let allowed = ALLOWED_FIELDS.into_iter().collect::<BTreeSet<_>>();
        if let Some(field) = object
            .keys()
            .find(|field| !allowed.contains(field.as_str()))
        {
            return Err(invalid(format!(
                "launch intent contains forbidden or unsupported field '{field}'"
            )));
        }
        let intent = Self {
            effect_id: required(object, "effectId")?,
            agent_run_id: required(object, "agentRunId")?,
            automation_attempt_id: optional(object, "automationAttemptId")?,
            request_id: required(object, "requestId")?,
            project_id: required(object, "projectId")?,
            issue_id: required(object, "issueId")?,
            scope: required(object, "scope")?,
            provider: optional(object, "provider")?,
            target_kind: required(object, "targetKind")?,
            target_id: required(object, "targetId")?,
            policy_reference: optional(object, "policyReference")?,
        };
        intent.validate()?;
        Ok(intent)
    }

    pub fn validate(&self) -> Result<(), RunsPersistenceError> {
        for (name, value) in [
            ("effectId", self.effect_id.as_str()),
            ("agentRunId", self.agent_run_id.as_str()),
            ("requestId", self.request_id.as_str()),
            ("projectId", self.project_id.as_str()),
            ("issueId", self.issue_id.as_str()),
            ("scope", self.scope.as_str()),
            ("targetKind", self.target_kind.as_str()),
            ("targetId", self.target_id.as_str()),
        ] {
            if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
                return Err(invalid(format!("launch intent field '{name}' is invalid")));
            }
        }
        for (name, value) in [
            ("automationAttemptId", self.automation_attempt_id.as_deref()),
            ("provider", self.provider.as_deref()),
            ("policyReference", self.policy_reference.as_deref()),
        ] {
            if value.is_some_and(|value| {
                value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control)
            }) {
                return Err(invalid(format!("launch intent field '{name}' is invalid")));
            }
        }
        if self.scope == "shell" {
            if self.provider.is_some()
                || self.automation_attempt_id.is_some()
                || self.policy_reference.is_some()
            {
                return Err(invalid(
                    "shell launch intent cannot carry provider or workflow metadata",
                ));
            }
        } else if self.provider.is_none() {
            return Err(invalid("agent launch intent requires a provider"));
        }
        Ok(())
    }
}

fn required(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<String, RunsPersistenceError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("launch intent requires string field '{field}'")))
}

fn optional(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Option<String>, RunsPersistenceError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(invalid(format!(
            "launch intent field '{field}' must be a string or null"
        ))),
    }
}

fn invalid(message: impl Into<String>) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::InvalidLaunchIntent, message)
}
