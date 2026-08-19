//! Crash-safe convergence of prepared, abandoned, and cleanup-pending effects.
//!
//! A restart cannot know whether a claimed effect ever produced a runtime, and
//! an expired lease is not permission to spawn a second one. Every decision
//! here starts from what the deterministic runtime identity actually shows:
//! a matching runtime is adopted, an absent one may be executed again under the
//! same predetermined identities, a contradicting one becomes a durable
//! non-retryable failure, and anything unproven is left for the next pass.

use std::sync::Arc;

use serde_json::json;

use super::launch_cleanup::CleanupProgress;
use super::launch_scan;
use super::{
    EffectService, LaunchDispatchService, LaunchEffectRecord, LaunchExecutor, LaunchOutcome,
    LaunchRuntimeProbe, RunsPersistenceError, RunsPersistenceErrorCode, RuntimeIdentity,
    RuntimeObservation,
};

/// Reconciliation claims are short: a pass that dies mid-decision must become
/// eligible again quickly, and nothing it does depends on holding the lease
/// longer than one adoption or execution.
const RECONCILE_LEASE_SECONDS: i64 = 120;

/// One pass reconciles a bounded batch. Whatever is left over is picked up by
/// the next pass, so a large backlog cannot stall startup.
pub const MAX_RECONCILIATION_BATCH: u64 = 200;

/// The typed conflict recorded when a foreign runtime holds the deterministic
/// identity. It is never retried, because retrying could only duplicate it.
pub const RUNTIME_CONFLICT_CODE: &str = "launch_runtime_conflict";

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReconciliationDecision {
    /// A live runtime matched the immutable intent and was adopted under the
    /// effect's predetermined Agent Run identity.
    Adopted { runtime_id: String },
    /// No runtime existed, so the effect was executed again under the same
    /// effect and run identities. `state` is the effect's settled state.
    Executed { state: String },
    /// A contradicting runtime made the effect a durable non-retryable failure.
    Conflicted { runtime_id: String },
    /// The external runtime is provably gone and the failure is now settled.
    CleanupCompleted,
    /// Cleanup could not be proven complete. The effect stays cleanup-pending
    /// with durable evidence and is reconciled again.
    CleanupPending,
    /// Nothing was decided: the runtime could not be observed, or another
    /// worker owns the effect. The effect is untouched.
    Deferred { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReconciledEffect {
    pub effect_id: String,
    pub agent_run_id: String,
    pub decision: ReconciliationDecision,
}

#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct ReconciliationReport {
    pub reconciled: Vec<ReconciledEffect>,
}

impl ReconciliationReport {
    pub fn decision(&self, effect_id: &str) -> Option<&ReconciliationDecision> {
        let effect_id = super::launch_claim::database_uuid(effect_id);
        self.reconciled
            .iter()
            .find(|entry| entry.effect_id == effect_id)
            .map(|entry| &entry.decision)
    }
}

/// Drains the durable launch backlog. It owns no schedule of its own: startup
/// and any supervising caller drive it, and every pass is idempotent.
#[derive(Clone)]
pub struct LaunchReconciliationService {
    effects: EffectService,
    probe: Arc<dyn LaunchRuntimeProbe>,
    dispatch: LaunchDispatchService,
}

impl LaunchReconciliationService {
    pub(crate) fn new(
        effects: EffectService,
        probe: Arc<dyn LaunchRuntimeProbe>,
        executor: Arc<dyn LaunchExecutor>,
    ) -> Self {
        let dispatch = LaunchDispatchService::new(effects.clone(), executor);
        Self {
            effects,
            probe,
            dispatch,
        }
    }

    pub fn lease_owner(&self) -> &str {
        self.dispatch.lease_owner()
    }

    /// Reconcile every effect that a crash could have abandoned: prepared
    /// effects nobody claimed, claims whose lease expired, and failures whose
    /// cleanup was never proven.
    pub async fn reconcile(&self) -> Result<ReconciliationReport, RunsPersistenceError> {
        let due = launch_scan::due(self.effects.database(), MAX_RECONCILIATION_BATCH).await?;
        let mut reconciled = Vec::with_capacity(due.len());
        for effect in due {
            let decision = self.reconcile_effect(&effect).await?;
            reconciled.push(ReconciledEffect {
                effect_id: effect.effect_id,
                agent_run_id: effect.agent_run_id,
                decision,
            });
        }
        Ok(ReconciliationReport { reconciled })
    }

    /// Reconcile one effect. The observation is taken before any state change,
    /// so lease expiry alone never causes a second runtime.
    async fn reconcile_effect(
        &self,
        effect: &LaunchEffectRecord,
    ) -> Result<ReconciliationDecision, RunsPersistenceError> {
        let observation = self
            .probe
            .observe(RuntimeIdentity::of(effect))
            .await
            .sanitized();
        if effect.state == "cleanup_pending" {
            return self.reconcile_cleanup(effect, observation).await;
        }
        match observation {
            RuntimeObservation::Absent => self.execute_again(effect).await,
            RuntimeObservation::Live { runtime_id } => self.adopt(effect, runtime_id).await,
            RuntimeObservation::Conflicting { runtime_id, detail } => {
                self.record_conflict(effect, runtime_id, detail).await
            }
            RuntimeObservation::Uncertain { detail } => {
                Ok(ReconciliationDecision::Deferred { reason: detail })
            }
        }
    }

    /// Cleanup ends only when the runtime is provably gone. Every other answer
    /// keeps the authoritative rows and records fresh evidence.
    async fn reconcile_cleanup(
        &self,
        effect: &LaunchEffectRecord,
        observation: RuntimeObservation,
    ) -> Result<ReconciliationDecision, RunsPersistenceError> {
        let progress = match &observation {
            RuntimeObservation::Absent => CleanupProgress::Complete,
            RuntimeObservation::Live { runtime_id } => CleanupProgress::Pending {
                evidence: json!({ "runtimeId": runtime_id, "survives": true }),
            },
            RuntimeObservation::Conflicting { runtime_id, detail } => CleanupProgress::Pending {
                evidence: json!({ "runtimeId": runtime_id, "conflict": detail }),
            },
            RuntimeObservation::Uncertain { detail } => CleanupProgress::Pending {
                evidence: json!({ "uncertain": detail }),
            },
        };
        let complete = progress == CleanupProgress::Complete;
        self.effects
            .record_cleanup_progress(&effect.effect_id, progress)
            .await?;
        Ok(if complete {
            ReconciliationDecision::CleanupCompleted
        } else {
            ReconciliationDecision::CleanupPending
        })
    }

    /// An absent runtime is the only permission to execute again, and the
    /// re-execution reuses the same effect and Agent Run identities.
    async fn execute_again(
        &self,
        effect: &LaunchEffectRecord,
    ) -> Result<ReconciliationDecision, RunsPersistenceError> {
        match self.dispatch.dispatch(&effect.effect_id).await {
            Ok(recorded) => Ok(ReconciliationDecision::Executed {
                state: recorded.effect.state,
            }),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    async fn adopt(
        &self,
        effect: &LaunchEffectRecord,
        runtime_id: String,
    ) -> Result<ReconciliationDecision, RunsPersistenceError> {
        let outcome = LaunchOutcome::Applied {
            runtime_evidence: json!({
                "runtimeId": runtime_id,
                "adopted": true,
                "reconciled": true,
            }),
        };
        match self.settle(effect, outcome).await {
            Ok(()) => Ok(ReconciliationDecision::Adopted { runtime_id }),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    async fn record_conflict(
        &self,
        effect: &LaunchEffectRecord,
        runtime_id: String,
        detail: String,
    ) -> Result<ReconciliationDecision, RunsPersistenceError> {
        let outcome = LaunchOutcome::Conflicted {
            code: RUNTIME_CONFLICT_CODE.to_owned(),
            message: detail.clone(),
            runtime_evidence: json!({
                "runtimeId": runtime_id,
                "conflict": detail,
                "adopted": false,
            }),
        };
        match self.settle(effect, outcome).await {
            Ok(()) => Ok(ReconciliationDecision::Conflicted { runtime_id }),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    /// Take the effect through the same claim the executor would need, so a
    /// reconciler that loses the compare-and-set writes nothing at all.
    async fn settle(
        &self,
        effect: &LaunchEffectRecord,
        outcome: LaunchOutcome,
    ) -> Result<(), RunsPersistenceError> {
        self.effects
            .claim(
                &effect.effect_id,
                self.lease_owner(),
                RECONCILE_LEASE_SECONDS,
            )
            .await?;
        self.effects
            .record_outcome(&effect.effect_id, self.lease_owner(), outcome)
            .await
            .map(|_| ())
    }
}

/// Another worker settled or claimed the effect first. That is a normal
/// concurrent outcome, not a reconciliation failure.
fn contended(error: &RunsPersistenceError) -> bool {
    matches!(
        error.code(),
        RunsPersistenceErrorCode::LaunchConflict | RunsPersistenceErrorCode::LaunchLeaseNotHeld
    )
}

fn deferred(error: RunsPersistenceError) -> ReconciliationDecision {
    ReconciliationDecision::Deferred {
        reason: error.to_string(),
    }
}
