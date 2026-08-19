//! The temporary compatibility boundary to the still-Python terminal
//! capability.
//!
//! Rust owns every Runs table. Django owns only the external terminal runtime,
//! so this port asks it two questions and nothing else: what exists under a
//! deterministic runtime identity, and please create the runtime for one
//! already-durable effect. Both directions carry identities and typed
//! outcomes; neither carries a prompt, a command line, a path, or a credential,
//! and Django is given no attempt identity or authority to mint a run.

use async_trait::async_trait;
use reqwest::{Client, Method};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::runs_persistence::{
    ClaimedLaunch, LaunchExecutor, LaunchExecutorFailure, LaunchRuntimeEvidence,
    LaunchRuntimeProbe, RuntimeIdentity, RuntimeObservation,
};

const READINESS_PATH: &str = "/terminals/runs-effects";
const OBSERVE_PATH: &str = "/terminals/runs-effects/observe";
const EXECUTE_PATH: &str = "/terminals/runs-effects/execute";

/// The exact health record the Python executor must publish before Rust will
/// call it. Anything else keeps Slice 3 readiness closed.
#[derive(Debug, Deserialize, Eq, PartialEq)]
struct ExecutorReadiness {
    version: i32,
    ready: bool,
    runs_owner: String,
    effect_owner: String,
    django_runs_write_fallback: bool,
}

#[derive(Clone)]
pub struct RunsEffectPort {
    client: Client,
    base_url: String,
    api_key: String,
}

impl RunsEffectPort {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
        }
    }

    /// Prove the temporary executor is present, healthy, and has itself given
    /// up every Runs writer. A missing, malformed, or partial answer is a
    /// closed gate, not a warning.
    pub async fn verify_health(&self) -> Result<(), String> {
        let value = self
            .request(Method::GET, READINESS_PATH, None)
            .await
            .map_err(|_| "The terminal Runs effect port is unavailable.".to_owned())?;
        let readiness: ExecutorReadiness = serde_json::from_value(value)
            .map_err(|_| "The terminal Runs effect port returned an invalid health record.")?;
        if readiness
            != (ExecutorReadiness {
                version: 1,
                ready: true,
                runs_owner: "rust".to_owned(),
                effect_owner: "django".to_owned(),
                django_runs_write_fallback: false,
            })
        {
            return Err(
                "The terminal Runs effect port has not given up Django Runs writes.".into(),
            );
        }
        Ok(())
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "effect_port_unavailable".to_owned())?;
        let status = response.status();
        let value = response
            .json::<Value>()
            .await
            .map_err(|_| "effect_port_invalid_response".to_owned())?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(value
                .get("code")
                .or_else(|| value.get("detail"))
                .and_then(Value::as_str)
                .unwrap_or("effect_port_failed")
                .to_owned())
        }
    }
}

/// Exactly the immutable intent the executor needs to find or create the
/// deterministic runtime. Nothing here is secret or executable.
fn identity_payload(identity: &RuntimeIdentity) -> Value {
    json!({
        "effect_id": identity.effect_id,
        "agent_run_id": identity.agent_run_id,
        "project_id": identity.project_id,
        "issue_id": identity.issue_id,
        "scope": identity.scope,
        "provider": identity.provider,
        "target_kind": identity.target_kind,
        "target_id": identity.target_id,
    })
}

#[async_trait]
impl LaunchRuntimeProbe for RunsEffectPort {
    async fn observe(&self, identity: RuntimeIdentity) -> RuntimeObservation {
        let value = match self
            .request(
                Method::POST,
                OBSERVE_PATH,
                Some(identity_payload(&identity)),
            )
            .await
        {
            Ok(value) => value,
            // An unreachable executor proves nothing. Reconciliation must not
            // read that as "absent" and start a second terminal.
            Err(detail) => return RuntimeObservation::Uncertain { detail },
        };
        let runtime_id = value
            .get("runtime_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        match value.get("observation").and_then(Value::as_str) {
            Some("absent") => RuntimeObservation::Absent,
            Some("live") if !runtime_id.is_empty() => RuntimeObservation::Live { runtime_id },
            Some("conflicting") if !runtime_id.is_empty() => RuntimeObservation::Conflicting {
                runtime_id,
                detail: value
                    .get("detail")
                    .and_then(Value::as_str)
                    .unwrap_or("runtime_identity_conflict")
                    .to_owned(),
            },
            _ => RuntimeObservation::Uncertain {
                detail: "effect_port_unreadable_observation".to_owned(),
            },
        }
    }
}

#[async_trait]
impl LaunchExecutor for RunsEffectPort {
    async fn execute(
        &self,
        claim: ClaimedLaunch,
    ) -> Result<LaunchRuntimeEvidence, LaunchExecutorFailure> {
        // A claim carries exactly two identities. The executor resolves its own
        // provider and runtime policy from approved sources, so nothing else
        // needs to — or may — cross this boundary.
        let payload = json!({
            "effect_id": claim.effect_id,
            "agent_run_id": claim.agent_run_id,
        });
        let value = self
            .request(Method::POST, EXECUTE_PATH, Some(payload))
            .await
            .map_err(|code| LaunchExecutorFailure {
                code,
                message: "The terminal effect executor did not answer.".to_owned(),
                retryable: true,
                // An executor that never answered cannot have proven cleanup,
                // so the effect stays cleanup-pending rather than being closed.
                cleanup_confirmed: false,
            })?;
        if value.get("ok").and_then(Value::as_bool) == Some(true) {
            let runtime_id = value
                .get("runtime_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if runtime_id.is_empty() {
                return Err(LaunchExecutorFailure {
                    code: "effect_port_invalid_response".to_owned(),
                    message: "The terminal effect executor reported no runtime.".to_owned(),
                    retryable: false,
                    cleanup_confirmed: false,
                });
            }
            return Ok(LaunchRuntimeEvidence {
                runtime_id,
                adopted: value.get("adopted").and_then(Value::as_bool) == Some(true),
            });
        }
        Err(LaunchExecutorFailure {
            code: value
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("effect_port_failed")
                .to_owned(),
            message: "The terminal effect executor could not create the runtime.".to_owned(),
            retryable: value.get("retryable").and_then(Value::as_bool) != Some(false),
            cleanup_confirmed: value.get("cleanup_confirmed").and_then(Value::as_bool)
                == Some(true),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_health_record_is_accepted() {
        let complete = json!({
            "version": 1,
            "ready": true,
            "runs_owner": "rust",
            "effect_owner": "django",
            "django_runs_write_fallback": false,
        });
        assert!(serde_json::from_value::<ExecutorReadiness>(complete.clone()).is_ok());

        for (field, value) in [
            ("ready", json!(false)),
            ("runs_owner", json!("django")),
            ("django_runs_write_fallback", json!(true)),
        ] {
            let mut degraded = complete.clone();
            degraded[field] = value;
            let readiness: ExecutorReadiness =
                serde_json::from_value(degraded).expect("decode the degraded record");
            assert_ne!(
                readiness,
                ExecutorReadiness {
                    version: 1,
                    ready: true,
                    runs_owner: "rust".to_owned(),
                    effect_owner: "django".to_owned(),
                    django_runs_write_fallback: false,
                }
            );
        }
    }

    #[test]
    fn the_identity_payload_carries_no_secret_or_command() {
        let payload = identity_payload(&RuntimeIdentity {
            effect_id: "effect".to_owned(),
            agent_run_id: "run".to_owned(),
            project_id: "project".to_owned(),
            issue_id: "issue".to_owned(),
            scope: "ticket".to_owned(),
            provider: "claude".to_owned(),
            target_kind: "work_item".to_owned(),
            target_id: "target".to_owned(),
            state: "prepared".to_owned(),
            attempt_count: 3,
        });
        let object = payload.as_object().expect("an object payload");
        assert_eq!(object.len(), 8);
        for forbidden in [
            "prompt",
            "command",
            "cwd",
            "env",
            "token",
            "api_key",
            "state",
            "attempt_count",
        ] {
            assert!(!object.contains_key(forbidden), "leaked {forbidden}");
        }
    }
}
