//! Read-only inspection of the deterministic runtime identity.
//!
//! Reconciliation may never guess what a crashed executor did. It asks this
//! port what exists under the effect's deterministic identity and decides from
//! the answer alone. A probe observes; it never creates, terminates, or writes
//! a Runs table, and it receives no prompt, command, path, or credential.

use async_trait::async_trait;

use super::LaunchEffectRecord;

/// Everything a probe is allowed to know about the launch it inspects: the two
/// predetermined identities and the immutable intent the runtime must match.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeIdentity {
    pub effect_id: String,
    pub agent_run_id: String,
    pub project_id: String,
    pub issue_id: String,
    pub scope: String,
    pub provider: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    /// Durable diagnostics the probe may use to bound its own work. They are
    /// facts about the effect, not permission to act on it.
    pub state: String,
    pub attempt_count: i32,
}

impl RuntimeIdentity {
    pub fn of(effect: &LaunchEffectRecord) -> Self {
        Self {
            effect_id: effect.effect_id.clone(),
            agent_run_id: effect.agent_run_id.clone(),
            project_id: effect.project_id.clone(),
            issue_id: effect.issue_id.clone(),
            scope: effect.scope.clone(),
            provider: effect.provider.clone(),
            target_kind: effect.target_kind.clone(),
            target_id: effect.target_id.clone(),
            state: effect.state.clone(),
            attempt_count: effect.attempt_count,
        }
    }
}

/// What the probe found under the deterministic identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeObservation {
    /// No runtime exists. Only this answer permits executing the effect again.
    Absent,
    /// A live runtime whose deterministic identity and immutable launch intent
    /// both match. It is adopted rather than duplicated.
    Live { runtime_id: String },
    /// A runtime holds the deterministic identity but contradicts the intent.
    /// It is never overwritten, terminated, or adopted.
    Conflicting { runtime_id: String, detail: String },
    /// The probe could not prove either answer. Nothing is decided, and the
    /// effect is left exactly as it was for the next reconciliation pass.
    Uncertain { detail: String },
}

impl RuntimeObservation {
    /// Probe detail is durable diagnostics, so it is bounded and control-free
    /// before it can reach a row. A probe that reports something unbounded is
    /// treated as uncertain rather than trusted.
    pub fn sanitized(self) -> Self {
        match self {
            Self::Live { runtime_id } => match bounded(&runtime_id) {
                Some(runtime_id) => Self::Live { runtime_id },
                None => Self::Uncertain {
                    detail: "The probe reported an unusable runtime identity.".to_owned(),
                },
            },
            Self::Conflicting { runtime_id, detail } => {
                match (bounded(&runtime_id), bounded(&detail)) {
                    (Some(runtime_id), Some(detail)) => Self::Conflicting { runtime_id, detail },
                    _ => Self::Uncertain {
                        detail: "The probe reported an unusable conflict description.".to_owned(),
                    },
                }
            }
            Self::Uncertain { detail } => Self::Uncertain {
                detail: bounded(&detail)
                    .unwrap_or_else(|| "The runtime observation is unavailable.".to_owned()),
            },
            Self::Absent => Self::Absent,
        }
    }
}

const MAX_DETAIL: usize = 500;

fn bounded(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= MAX_DETAIL && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

#[async_trait]
pub trait LaunchRuntimeProbe: Send + Sync {
    /// Observe the runtime that the deterministic identity would own. A probe
    /// that cannot answer returns `Uncertain` rather than guessing `Absent`,
    /// because only `Absent` permits a second execution.
    async fn observe(&self, identity: RuntimeIdentity) -> RuntimeObservation;
}

#[cfg(test)]
mod tests {
    use super::{RuntimeObservation, MAX_DETAIL};

    #[test]
    fn unbounded_probe_detail_degrades_to_uncertain_instead_of_reaching_a_row() {
        let conflicting = RuntimeObservation::Conflicting {
            runtime_id: "runtime-a".to_owned(),
            detail: "x".repeat(MAX_DETAIL + 1),
        }
        .sanitized();
        assert!(matches!(conflicting, RuntimeObservation::Uncertain { .. }));

        let live = RuntimeObservation::Live {
            runtime_id: "runtime\u{7}a".to_owned(),
        }
        .sanitized();
        assert!(matches!(live, RuntimeObservation::Uncertain { .. }));
    }
}
