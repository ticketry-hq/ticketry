//! Durable outcome of one claimed launch.
//!
//! Success, typed failure, retryability, terminal run outcome, and
//! cleanup-pending state all settle in one transaction with the owning
//! Automation Attempt and Agent Run, so no crash can leave the effect and its
//! projections disagreeing about what happened.

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::{json, Value};

use super::entities::launch_effect as launch_effect_entity;
use super::launch_claim::{database_uuid, validate_owner};
use super::repositories::launch_effect;
use super::{
    attempt_commands, timestamp, AttemptOutcome, AutomationAttemptProjection, EffectService,
    LaunchEffectRecord, RunsPersistenceError, RunsPersistenceErrorCode, TerminalFact,
    TerminalOutcome,
};

#[derive(Clone, Debug, PartialEq)]
pub enum LaunchOutcome {
    Applied {
        /// Deterministic runtime identity proving the effect was performed.
        runtime_evidence: Value,
    },
    Failed {
        code: String,
        message: String,
        retryable: bool,
        /// False when the executor could not prove the external runtime is
        /// gone. The effect then stays cleanup-pending and its application
        /// rows survive for reconciliation.
        cleanup_confirmed: bool,
    },
    /// Reconciliation found a runtime holding the deterministic identity that
    /// contradicts the effect's immutable intent. That runtime belongs to
    /// something else: it is never adopted, overwritten, or cleaned up here,
    /// and the effect becomes a durable non-retryable failure.
    Conflicted {
        code: String,
        message: String,
        runtime_evidence: Value,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecordedLaunch {
    pub effect: LaunchEffectRecord,
    pub attempt: Option<AutomationAttemptProjection>,
    pub settled: bool,
}

/// A model row that must settle in the same transaction as an applied launch.
#[async_trait]
pub trait LaunchSettlementParticipant: Send + Sync {
    async fn settle_applied_in(
        &self,
        transaction: &DatabaseTransaction,
        effect: &LaunchEffectRecord,
        settled_at: &str,
        runtime_evidence: &Value,
    ) -> Result<(), RunsPersistenceError>;
}

struct NoLaunchSettlementParticipant;

#[async_trait]
impl LaunchSettlementParticipant for NoLaunchSettlementParticipant {
    async fn settle_applied_in(
        &self,
        _transaction: &DatabaseTransaction,
        _effect: &LaunchEffectRecord,
        _settled_at: &str,
        _runtime_evidence: &Value,
    ) -> Result<(), RunsPersistenceError> {
        Ok(())
    }
}

impl EffectService {
    pub async fn record_outcome(
        &self,
        effect_id: &str,
        lease_owner: &str,
        outcome: LaunchOutcome,
    ) -> Result<RecordedLaunch, RunsPersistenceError> {
        self.record_outcome_with(
            effect_id,
            lease_owner,
            outcome,
            &NoLaunchSettlementParticipant,
        )
        .await
    }

    pub async fn record_outcome_with(
        &self,
        effect_id: &str,
        lease_owner: &str,
        outcome: LaunchOutcome,
        participant: &dyn LaunchSettlementParticipant,
    ) -> Result<RecordedLaunch, RunsPersistenceError> {
        validate_owner(lease_owner)?;
        validate_outcome(&outcome)?;
        let effect_id = database_uuid(effect_id);
        let transaction = self.database().begin().await?;
        let current = load(&transaction, &effect_id).await?;

        if let Some(settled) = already_settled(&current, &outcome)? {
            transaction.commit().await?;
            return Ok(RecordedLaunch {
                effect: settled,
                attempt: None,
                settled: false,
            });
        }
        validate_lease(&current, lease_owner)?;

        let now = Utc::now();
        let settled_at = timestamp::database_format(now);
        let attempt = match &outcome {
            LaunchOutcome::Applied { runtime_evidence } => {
                apply(&transaction, &effect_id, runtime_evidence, &settled_at).await?;
                participant
                    .settle_applied_in(&transaction, &current, &settled_at, runtime_evidence)
                    .await?;
                if current.automation_attempt_id.is_some() {
                    let agent = current.provider.clone().ok_or_else(|| {
                        invalid("An automation launch effect must bind a provider.")
                    })?;
                    self.project_attempt(
                        &transaction,
                        &current,
                        AttemptOutcome::Succeeded {
                            agent,
                            agent_run_id: current.agent_run_id.clone(),
                        },
                    )
                    .await?
                } else {
                    None
                }
            }
            LaunchOutcome::Failed {
                code,
                message,
                retryable,
                cleanup_confirmed,
            } => {
                fail(
                    &transaction,
                    &effect_id,
                    code,
                    message,
                    *cleanup_confirmed,
                    None,
                    &settled_at,
                )
                .await?;
                let attempt = self
                    .project_attempt(
                        &transaction,
                        &current,
                        AttemptOutcome::Failed {
                            error: message.clone(),
                            failure: json!({
                                "code": code,
                                "cleanupPending": !cleanup_confirmed,
                            }),
                            retryable: *retryable,
                        },
                    )
                    .await?;
                // A launch that never produced a usable runtime leaves no
                // provider to report an exit, so the run's terminal authority
                // is recorded here rather than waited for.
                self.lifecycle()
                    .apply_terminal_fact_in(
                        &transaction,
                        TerminalFact {
                            agent_run_id: current.agent_run_id.clone(),
                            outcome: TerminalOutcome::Failed,
                            occurred_at: timestamp::format(now),
                            exit_code: None,
                        },
                    )
                    .await?;
                attempt
            }
            LaunchOutcome::Conflicted {
                code,
                message,
                runtime_evidence,
            } => {
                // The conflicting runtime is not ours to end, so cleanup is
                // recorded as confirmed for this effect while the foreign
                // runtime evidence stays durable.
                fail(
                    &transaction,
                    &effect_id,
                    code,
                    message,
                    true,
                    Some(runtime_evidence),
                    &settled_at,
                )
                .await?;
                let attempt = self
                    .project_attempt(
                        &transaction,
                        &current,
                        AttemptOutcome::Failed {
                            error: message.clone(),
                            failure: json!({ "code": code, "cleanupPending": false }),
                            retryable: false,
                        },
                    )
                    .await?;
                self.lifecycle()
                    .apply_terminal_fact_in(
                        &transaction,
                        TerminalFact {
                            agent_run_id: current.agent_run_id.clone(),
                            outcome: TerminalOutcome::Failed,
                            occurred_at: timestamp::format(now),
                            exit_code: None,
                        },
                    )
                    .await?;
                attempt
            }
        };
        let effect = load(&transaction, &effect_id).await?;
        transaction.commit().await?;
        self.events().wake_committed();
        Ok(RecordedLaunch {
            effect,
            attempt,
            settled: true,
        })
    }

    async fn project_attempt(
        &self,
        transaction: &DatabaseTransaction,
        effect: &LaunchEffectRecord,
        outcome: AttemptOutcome,
    ) -> Result<Option<AutomationAttemptProjection>, RunsPersistenceError> {
        let Some(attempt_id) = effect.automation_attempt_id.as_deref() else {
            return Ok(None);
        };
        attempt_commands::record_outcome_in(transaction, self.events(), attempt_id, outcome)
            .await
            .map(Some)
    }
}

async fn apply(
    transaction: &DatabaseTransaction,
    effect_id: &str,
    runtime_evidence: &Value,
    settled_at: &str,
) -> Result<(), RunsPersistenceError> {
    launch_effect_entity::Entity::update_many()
        .col_expr(launch_effect_entity::Column::State, Expr::value("applied"))
        .col_expr(
            launch_effect_entity::Column::AppliedAt,
            Expr::value(settled_at),
        )
        .col_expr(
            launch_effect_entity::Column::RuntimeEvidence,
            Expr::value(runtime_evidence.to_string()),
        )
        .col_expr(
            launch_effect_entity::Column::LeaseOwner,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::LeaseExpiresAt,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::LastErrorCode,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::LastErrorMessage,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::UpdatedAt,
            Expr::value(settled_at),
        )
        .filter(launch_effect_entity::Column::EffectId.eq(effect_id))
        .exec(transaction)
        .await?;
    Ok(())
}

async fn fail(
    transaction: &DatabaseTransaction,
    effect_id: &str,
    code: &str,
    message: &str,
    cleanup_confirmed: bool,
    runtime_evidence: Option<&Value>,
    settled_at: &str,
) -> Result<(), RunsPersistenceError> {
    let state = if cleanup_confirmed {
        "failed"
    } else {
        "cleanup_pending"
    };
    let mut update = launch_effect_entity::Entity::update_many()
        .col_expr(launch_effect_entity::Column::State, Expr::value(state));
    if let Some(evidence) = runtime_evidence {
        update = update.col_expr(
            launch_effect_entity::Column::RuntimeEvidence,
            Expr::value(evidence.to_string()),
        );
    }
    update
        .col_expr(
            launch_effect_entity::Column::LastErrorCode,
            Expr::value(code),
        )
        .col_expr(
            launch_effect_entity::Column::LastErrorMessage,
            Expr::value(message),
        )
        .col_expr(
            launch_effect_entity::Column::LeaseOwner,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::LeaseExpiresAt,
            Expr::value(None::<String>),
        )
        .col_expr(
            launch_effect_entity::Column::UpdatedAt,
            Expr::value(settled_at),
        )
        .filter(launch_effect_entity::Column::EffectId.eq(effect_id))
        .exec(transaction)
        .await?;
    Ok(())
}

/// A retried acknowledgement of an outcome the effect already holds is a
/// no-op; a contradicting one is a typed conflict.
fn already_settled(
    current: &LaunchEffectRecord,
    outcome: &LaunchOutcome,
) -> Result<Option<LaunchEffectRecord>, RunsPersistenceError> {
    match (current.state.as_str(), outcome) {
        ("applied", LaunchOutcome::Applied { .. }) => Ok(Some(current.clone())),
        (
            "failed" | "cleanup_pending",
            LaunchOutcome::Failed { code, .. } | LaunchOutcome::Conflicted { code, .. },
        ) if current.last_error_code.as_deref() == Some(code.as_str()) => Ok(Some(current.clone())),
        ("applied" | "failed" | "cleanup_pending", _) => Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::LaunchConflict,
            "The Launch Effect already holds a different terminal outcome.",
        )),
        _ => Ok(None),
    }
}

fn validate_lease(
    current: &LaunchEffectRecord,
    lease_owner: &str,
) -> Result<(), RunsPersistenceError> {
    let held = current.state == "leased"
        && current.lease_owner.as_deref() == Some(lease_owner)
        && current
            .lease_expires_at
            .as_deref()
            .is_some_and(|expires| expires > timestamp::database_now().as_str());
    if held {
        return Ok(());
    }
    Err(RunsPersistenceError::new(
        RunsPersistenceErrorCode::LaunchLeaseNotHeld,
        "The launch outcome requires a live lease held by its reporter.",
    ))
}

fn validate_outcome(outcome: &LaunchOutcome) -> Result<(), RunsPersistenceError> {
    match outcome {
        LaunchOutcome::Applied { runtime_evidence } if !runtime_evidence.is_object() => Err(
            invalid("Applied launches require a runtime evidence object."),
        ),
        LaunchOutcome::Failed { code, message, .. }
        | LaunchOutcome::Conflicted { code, message, .. }
            if !is_bounded(code, 64) || !is_bounded(message, 2000) =>
        {
            Err(invalid(
                "Failed launches require a bounded typed code and message.",
            ))
        }
        LaunchOutcome::Conflicted {
            runtime_evidence, ..
        } if !runtime_evidence.is_object() => Err(invalid(
            "Conflicting runtimes require a runtime evidence object.",
        )),
        _ => Ok(()),
    }
}

fn is_bounded(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

async fn load(
    transaction: &DatabaseTransaction,
    effect_id: &str,
) -> Result<LaunchEffectRecord, RunsPersistenceError> {
    launch_effect_entity::Entity::find_by_id(effect_id)
        .one(transaction)
        .await?
        .map(launch_effect)
        .ok_or_else(missing_effect)
}

pub fn missing_effect() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::LaunchEffectNotFound,
        "The Launch Effect does not exist.",
    )
}

fn invalid(message: &'static str) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::InvalidLaunchIntent, message)
}
