use sea_orm::EntityTrait;
use serde_json::json;

use crate::runs_persistence::{ClaimedLaunch, LaunchOutcome};
use ticketry_entities::terminals::{launch_material, session};

use super::settlement::SessionSettlement;
use super::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use crate::launch::terminal_session::{TerminalLaunchError, TerminalLaunchErrorCode};

const LEASE_SECONDS: i64 = 120;
const RECOVERY_BATCH: u64 = 200;

impl TerminalLaunchService {
    pub(super) async fn execute(
        &self,
        material: launch_material::Model,
    ) -> Result<session::Model, TerminalLaunchError> {
        let claim = self
            .runs
            .effects()
            .claim(&material.effect_id, &self.lease_owner, LEASE_SECONDS)
            .await?;
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::EffectClaimed)
            .await?;

        let observed = self.runtime.observe(&claim.agent_run_id).await;
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::PreEffectObserved)
            .await?;
        match observed {
            TerminalRuntimeObservation::Running(runtime) => {
                self.settle(&claim, material, runtime).await
            }
            TerminalRuntimeObservation::Missing => self.create_missing(&claim, material).await,
            TerminalRuntimeObservation::Foreign | TerminalRuntimeObservation::Ambiguous => {
                if claim.attempt_count > 1 {
                    self.cleanup_pending(
                        &claim,
                        TerminalLaunchErrorCode::RuntimeConflict,
                        "A prior launch attempt left an unverified runtime identity.",
                    )
                    .await
                } else {
                    self.conflict(
                        &claim,
                        "A runtime holds the intended identity for different work.",
                    )
                    .await
                }
            }
            TerminalRuntimeObservation::Exited { .. } => {
                self.cleanup_pending(
                    &claim,
                    TerminalLaunchErrorCode::RuntimeExited,
                    "The intended terminal runtime exited before settlement.",
                )
                .await
            }
            TerminalRuntimeObservation::Unavailable => {
                self.defer(
                    &claim,
                    TerminalLaunchErrorCode::RuntimeUnavailable,
                    "The terminal runtime could not be inspected.",
                )
                .await
            }
        }
    }

    /// Run a bounded recovery pass over terminal-owned launch effects. Other
    /// Runs effects and cleanup-pending launches stay with their owning worker.
    pub async fn reconcile(&self) -> Result<TerminalLaunchRecoveryReport, TerminalLaunchError> {
        let due = self.runs.effects().due(RECOVERY_BATCH).await?;
        let mut report = TerminalLaunchRecoveryReport::default();
        for effect in due {
            let Some(material) = launch_material::Entity::find_by_id(&effect.effect_id)
                .one(&self.database)
                .await
                .map_err(super::service::storage)?
            else {
                continue;
            };
            if effect.state == "cleanup_pending" {
                report.cleanup_pending += 1;
                continue;
            }
            match self.execute(material).await {
                Ok(_) => report.applied += 1,
                Err(error)
                    if matches!(
                        error.code,
                        TerminalLaunchErrorCode::RuntimeUnavailable
                            | TerminalLaunchErrorCode::EffectBusy
                            | TerminalLaunchErrorCode::InjectedStop
                    ) =>
                {
                    report.deferred += 1;
                }
                Err(_) => report.settled_failures += 1,
            }
        }
        Ok(report)
    }

    async fn create_missing(
        &self,
        claim: &ClaimedLaunch,
        material: launch_material::Model,
    ) -> Result<session::Model, TerminalLaunchError> {
        let creation = self
            .runtime
            .materialize_and_create(&material, &self.checkpoints)
            .await;
        if creation
            .as_ref()
            .is_err_and(|error| error.code == TerminalLaunchErrorCode::InjectedStop)
        {
            return Err(creation.unwrap_err());
        }
        let observed = self.runtime.observe(&claim.agent_run_id).await;
        match observed {
            TerminalRuntimeObservation::Running(runtime) => {
                self.settle(claim, material, runtime).await
            }
            TerminalRuntimeObservation::Missing => match creation {
                Err(error)
                    if matches!(
                        error.code,
                        TerminalLaunchErrorCode::InvalidRequest
                            | TerminalLaunchErrorCode::Conflict
                            | TerminalLaunchErrorCode::RuntimeStartFailed
                            | TerminalLaunchErrorCode::RuntimeExited
                    ) =>
                {
                    self.failed(claim, error.code, &error.to_string()).await
                }
                _ => {
                    self.defer(
                        claim,
                        TerminalLaunchErrorCode::RuntimeUnavailable,
                        "The terminal runtime is provably absent and the launch may retry.",
                    )
                    .await
                }
            },
            TerminalRuntimeObservation::Foreign | TerminalRuntimeObservation::Ambiguous => {
                self.cleanup_pending(
                    claim,
                    TerminalLaunchErrorCode::RuntimeConflict,
                    "Creation left an unverified runtime identity; cleanup needs verified ownership.",
                )
                .await
            }
            TerminalRuntimeObservation::Exited { .. } => {
                self.cleanup_pending(
                    claim,
                    TerminalLaunchErrorCode::RuntimeExited,
                    "Creation left an exited runtime that requires verified cleanup.",
                )
                .await
            }
            TerminalRuntimeObservation::Unavailable => {
                self.cleanup_pending(
                    claim,
                    TerminalLaunchErrorCode::RuntimeUnavailable,
                    "Creation could not prove whether a runtime requires cleanup.",
                )
                .await
            }
        }
    }

    async fn settle(
        &self,
        claim: &ClaimedLaunch,
        material: launch_material::Model,
        runtime: VerifiedTerminalRuntime,
    ) -> Result<session::Model, TerminalLaunchError> {
        let run_id = material.agent_run_id.clone();
        let evidence = json!({
            "agentRunId": run_id,
            "runtimeNamespace": runtime.runtime_namespace,
            "verified": true,
        });
        let settlement = SessionSettlement {
            material,
            runtime,
            lifecycle: self.runs.lifecycle().clone(),
            checkpoints: self.checkpoints.clone(),
        };
        self.runs
            .effects()
            .record_outcome_with(
                &claim.effect_id,
                &claim.lease_owner,
                LaunchOutcome::Applied {
                    runtime_evidence: evidence,
                },
                &settlement,
            )
            .await?;
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::EffectAndStatusSettled)
            .await?;
        self.respond(&run_id).await
    }

    async fn defer<T>(
        &self,
        claim: &ClaimedLaunch,
        code: TerminalLaunchErrorCode,
        message: &str,
    ) -> Result<T, TerminalLaunchError> {
        let public = TerminalLaunchError::new(code, message);
        self.runs
            .effects()
            .defer_claim(
                &claim.effect_id,
                &claim.lease_owner,
                public.code_str(),
                message,
                json!({ "inspection": "deferred", "absenceProven": false }),
            )
            .await?;
        Err(public)
    }

    async fn conflict<T>(
        &self,
        claim: &ClaimedLaunch,
        message: &str,
    ) -> Result<T, TerminalLaunchError> {
        self.runs
            .effects()
            .record_outcome(
                &claim.effect_id,
                &claim.lease_owner,
                LaunchOutcome::Conflicted {
                    code: "terminal_runtime_identity_conflict".to_owned(),
                    message: message.to_owned(),
                    runtime_evidence: json!({ "verified": false, "overwritten": false }),
                },
            )
            .await?;
        Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::RuntimeConflict,
            message,
        ))
    }

    async fn cleanup_pending<T>(
        &self,
        claim: &ClaimedLaunch,
        code: TerminalLaunchErrorCode,
        message: &str,
    ) -> Result<T, TerminalLaunchError> {
        let public = TerminalLaunchError::new(code, message);
        self.runs
            .effects()
            .record_outcome(
                &claim.effect_id,
                &claim.lease_owner,
                LaunchOutcome::Failed {
                    code: public.code_str().to_owned(),
                    message: message.to_owned(),
                    retryable: false,
                    cleanup_confirmed: false,
                },
            )
            .await?;
        Err(public)
    }

    async fn failed<T>(
        &self,
        claim: &ClaimedLaunch,
        code: TerminalLaunchErrorCode,
        message: &str,
    ) -> Result<T, TerminalLaunchError> {
        let public = TerminalLaunchError::new(code, message);
        self.runs
            .effects()
            .record_outcome(
                &claim.effect_id,
                &claim.lease_owner,
                LaunchOutcome::Failed {
                    code: public.code_str().to_owned(),
                    message: message.to_owned(),
                    retryable: false,
                    cleanup_confirmed: true,
                },
            )
            .await?;
        Err(public)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TerminalLaunchRecoveryReport {
    pub applied: usize,
    pub deferred: usize,
    pub cleanup_pending: usize,
    pub settled_failures: usize,
}
