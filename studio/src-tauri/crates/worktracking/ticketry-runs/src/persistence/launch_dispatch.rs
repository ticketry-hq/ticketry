//! One launch, carried from durable intent to durable outcome.
//!
//! The ordering here is the whole point of the slice: durable fact first,
//! external effect second, durable outcome third. The executor is woken only
//! after preparation has committed, so a rolled-back preparation can never
//! produce a terminal.

use std::sync::Arc;

use serde_json::json;

use super::{
    EffectService, LaunchExecutor, LaunchOutcome, PrepareLaunchRequest, RecordedLaunch,
    RunsPersistenceError,
};

const DEFAULT_LEASE_SECONDS: i64 = 120;

#[derive(Clone)]
pub struct LaunchDispatchService {
    effects: EffectService,
    executor: Arc<dyn LaunchExecutor>,
    lease_owner: String,
    lease_seconds: i64,
}

impl LaunchDispatchService {
    pub fn new(effects: EffectService, executor: Arc<dyn LaunchExecutor>) -> Self {
        Self {
            effects,
            executor,
            lease_owner: uuid::Uuid::new_v4().simple().to_string(),
            lease_seconds: DEFAULT_LEASE_SECONDS,
        }
    }

    pub fn lease_owner(&self) -> &str {
        &self.lease_owner
    }

    /// Prepare and then perform one launch. A repeated transport request
    /// reuses its already-durable effect rather than starting a second one.
    pub async fn launch(
        &self,
        request: PrepareLaunchRequest,
    ) -> Result<RecordedLaunch, RunsPersistenceError> {
        let prepared = self.effects.prepare_launch(request).await?;
        // A repeated transport request finds its effect already settled. It
        // reports that settled truth rather than claiming a second time.
        if prepared.reused && prepared.effect.state != "prepared" {
            return Ok(RecordedLaunch {
                effect: prepared.effect,
                attempt: None,
                settled: false,
            });
        }
        self.dispatch(&prepared.effect.effect_id).await
    }

    /// Claim and perform one already-prepared effect. Reconciliation reaches
    /// the executor through this same seam, so a resumed effect keeps its
    /// predetermined identities.
    pub async fn dispatch(&self, effect_id: &str) -> Result<RecordedLaunch, RunsPersistenceError> {
        let claim = self
            .effects
            .claim(effect_id, &self.lease_owner, self.lease_seconds)
            .await?;
        let outcome = match self.executor.execute(claim).await {
            Ok(evidence) => LaunchOutcome::Applied {
                runtime_evidence: json!({
                    "runtimeId": evidence.runtime_id,
                    "adopted": evidence.adopted,
                }),
            },
            Err(failure) => LaunchOutcome::Failed {
                code: failure.code,
                message: failure.message,
                retryable: failure.retryable,
                cleanup_confirmed: failure.cleanup_confirmed,
            },
        };
        self.effects
            .record_outcome(effect_id, &self.lease_owner, outcome)
            .await
    }
}
