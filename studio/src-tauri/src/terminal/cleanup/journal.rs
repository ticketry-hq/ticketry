use std::sync::Arc;

use chrono::{Duration, SecondsFormat, Utc};
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, EntityTrait, ExprTrait, QueryFilter,
    TransactionTrait,
};
use serde_json::{json, Value};

use ticketry_entities::terminals::{cleanup_effect, session};
use ticketry_runs::persistence::{TerminalFact, TerminalOutcome};

use super::service::{not_found, observation_name, TerminalCleanupService};
use super::{
    CleanupCheckpoint, CleanupCheckpoints, CleanupEffectIdentity, CleanupRuntimeObservation,
    TerminalCleanupError, TerminalCleanupErrorCode,
};

const LEASE_SECONDS: i64 = 60;

impl TerminalCleanupService {
    pub(super) async fn authoritative(
        &self,
        run_id: &str,
    ) -> Result<session::Model, TerminalCleanupError> {
        session::Entity::find_by_id(run_id)
            .one(&self.database)
            .await?
            .ok_or_else(not_found)
    }

    pub(super) async fn prepare(
        &self,
        identity: &CleanupEffectIdentity,
    ) -> Result<cleanup_effect::Model, TerminalCleanupError> {
        let transaction = self.database.begin().await?;
        if let Some(existing) = cleanup_effect::Entity::find()
            .filter(cleanup_effect::Column::AgentRunId.eq(&identity.agent_run_id))
            .one(&transaction)
            .await?
        {
            if existing.effect_id != identity.effect_id || existing.cause != identity.cause.as_str()
            {
                return Err(TerminalCleanupError::new(
                    TerminalCleanupErrorCode::Conflict,
                    "The Terminal Session is bound to a different cleanup cause.",
                ));
            }
            transaction.commit().await?;
            return Ok(existing);
        }
        let now = now();
        cleanup_effect::ActiveModel {
            effect_id: sea_orm::ActiveValue::Set(identity.effect_id.clone()),
            agent_run_id: sea_orm::ActiveValue::Set(identity.agent_run_id.clone()),
            cause: sea_orm::ActiveValue::Set(identity.cause.as_str().to_owned()),
            state: sea_orm::ActiveValue::Set("prepared".to_owned()),
            lease_owner: sea_orm::ActiveValue::Set(None),
            lease_expires_at: sea_orm::ActiveValue::Set(None),
            attempt_count: sea_orm::ActiveValue::Set(0),
            last_error_code: sea_orm::ActiveValue::Set(None),
            last_error_message: sea_orm::ActiveValue::Set(None),
            runtime_evidence: sea_orm::ActiveValue::Set(None),
            created_at: sea_orm::ActiveValue::Set(now.clone()),
            updated_at: sea_orm::ActiveValue::Set(now),
            applied_at: sea_orm::ActiveValue::Set(None),
        }
        .insert(&transaction)
        .await?;
        session::Entity::update_many()
            .col_expr(session::Column::RuntimeCleanupPending, Expr::value(true))
            .filter(session::Column::AgentRunId.eq(&identity.agent_run_id))
            .exec(&transaction)
            .await?;
        let row = cleanup_effect::Entity::find_by_id(&identity.effect_id)
            .one(&transaction)
            .await?
            .ok_or_else(not_found)?;
        transaction.commit().await?;
        Ok(row)
    }

    pub(super) async fn claim(
        &self,
        effect_id: &str,
    ) -> Result<cleanup_effect::Model, TerminalCleanupError> {
        let transaction = self.database.begin().await?;
        let current = cleanup_effect::Entity::find_by_id(effect_id)
            .one(&transaction)
            .await?
            .ok_or_else(not_found)?;
        if current.state == "applied" {
            transaction.commit().await?;
            return Ok(current);
        }
        if current.state == "conflict" || current.state == "failed" {
            return Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::Conflict,
                "Terminal cleanup is already settled as a conflict.",
            ));
        }
        if current.state == "leased"
            && current
                .lease_expires_at
                .as_deref()
                .is_some_and(|expiry| expiry > now().as_str())
        {
            return Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::EffectBusy,
                "Terminal cleanup is already leased.",
            ));
        }
        let expiry = (Utc::now() + Duration::seconds(LEASE_SECONDS))
            .to_rfc3339_opts(SecondsFormat::Micros, true);
        cleanup_effect::Entity::update_many()
            .col_expr(cleanup_effect::Column::State, Expr::value("leased"))
            .col_expr(
                cleanup_effect::Column::LeaseOwner,
                Expr::value(Some(self.lease_owner.clone())),
            )
            .col_expr(
                cleanup_effect::Column::LeaseExpiresAt,
                Expr::value(Some(expiry)),
            )
            .col_expr(
                cleanup_effect::Column::AttemptCount,
                Expr::col(cleanup_effect::Column::AttemptCount).add(1),
            )
            .col_expr(cleanup_effect::Column::UpdatedAt, Expr::value(now()))
            .filter(cleanup_effect::Column::EffectId.eq(effect_id))
            .exec(&transaction)
            .await?;
        let claimed = cleanup_effect::Entity::find_by_id(effect_id)
            .one(&transaction)
            .await?
            .ok_or_else(not_found)?;
        transaction.commit().await?;
        Ok(claimed)
    }

    pub(super) async fn settle_applied(
        &self,
        claim: &cleanup_effect::Model,
        terminal: &session::Model,
        evidence: Value,
    ) -> Result<session::Model, TerminalCleanupError> {
        self.require_lease(claim)?;
        let transaction = self.database.begin().await?;
        let settled_at = now();
        session::Entity::update_many()
            .col_expr(
                session::Column::TerminatedAt,
                Expr::value(Some(settled_at.clone())),
            )
            .filter(session::Column::AgentRunId.eq(&terminal.agent_run_id))
            .filter(session::Column::TerminatedAt.is_null())
            .exec(&transaction)
            .await?;
        session::Entity::update_many()
            .col_expr(session::Column::RuntimeCleanupPending, Expr::value(false))
            .filter(session::Column::AgentRunId.eq(&terminal.agent_run_id))
            .exec(&transaction)
            .await?;
        self.checkpoints
            .reached(CleanupCheckpoint::TerminalTombstone)?;
        let run_checkpoints = self.checkpoints.clone();
        let status_checkpoints = self.checkpoints.clone();
        self.runs
            .lifecycle()
            .apply_terminal_fact_in_observed(
                &transaction,
                TerminalFact {
                    agent_run_id: terminal.agent_run_id.clone(),
                    outcome: if claim.cause == "hosted_exit" {
                        TerminalOutcome::Exited
                    } else {
                        TerminalOutcome::Terminated
                    },
                    occurred_at: settled_at.clone(),
                    exit_code: None,
                },
                move || cleanup_checkpoint(&run_checkpoints, CleanupCheckpoint::RunFact),
                move || cleanup_checkpoint(&status_checkpoints, CleanupCheckpoint::StatusAppend),
            )
            .await?;
        cleanup_effect::Entity::update_many()
            .col_expr(cleanup_effect::Column::State, Expr::value("applied"))
            .col_expr(
                cleanup_effect::Column::LeaseOwner,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::LeaseExpiresAt,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::LastErrorCode,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::LastErrorMessage,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::RuntimeEvidence,
                Expr::value(Some(evidence)),
            )
            .col_expr(
                cleanup_effect::Column::AppliedAt,
                Expr::value(Some(settled_at.clone())),
            )
            .col_expr(cleanup_effect::Column::UpdatedAt, Expr::value(settled_at))
            .filter(cleanup_effect::Column::EffectId.eq(&claim.effect_id))
            .filter(cleanup_effect::Column::LeaseOwner.eq(&self.lease_owner))
            .exec(&transaction)
            .await?;
        self.checkpoints.reached(CleanupCheckpoint::Settlement)?;
        let authoritative = session::Entity::find_by_id(&terminal.agent_run_id)
            .one(&transaction)
            .await?
            .ok_or_else(not_found)?;
        transaction.commit().await?;
        self.runs.lifecycle().events().wake_committed();
        self.checkpoints.reached(CleanupCheckpoint::Response)?;
        Ok(authoritative)
    }

    pub(super) async fn settle_pending(
        &self,
        claim: &cleanup_effect::Model,
        code: &str,
        message: &str,
        evidence: Value,
    ) -> Result<(), TerminalCleanupError> {
        self.settle_error(claim, "cleanup_pending", code, message, evidence)
            .await
    }

    pub(super) async fn settle_conflict(
        &self,
        claim: &cleanup_effect::Model,
        observation: CleanupRuntimeObservation,
    ) -> Result<(), TerminalCleanupError> {
        self.settle_error(
            claim,
            "conflict",
            "terminal_runtime_identity_conflict",
            "Runtime ownership could not be verified.",
            json!({"observation": observation_name(observation)}),
        )
        .await
    }

    async fn settle_error(
        &self,
        claim: &cleanup_effect::Model,
        state: &str,
        code: &str,
        message: &str,
        evidence: Value,
    ) -> Result<(), TerminalCleanupError> {
        self.require_lease(claim)?;
        cleanup_effect::Entity::update_many()
            .col_expr(cleanup_effect::Column::State, Expr::value(state))
            .col_expr(
                cleanup_effect::Column::LeaseOwner,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::LeaseExpiresAt,
                Expr::value(None::<String>),
            )
            .col_expr(
                cleanup_effect::Column::LastErrorCode,
                Expr::value(Some(code.to_owned())),
            )
            .col_expr(
                cleanup_effect::Column::LastErrorMessage,
                Expr::value(Some(message.to_owned())),
            )
            .col_expr(
                cleanup_effect::Column::RuntimeEvidence,
                Expr::value(Some(evidence)),
            )
            .col_expr(cleanup_effect::Column::UpdatedAt, Expr::value(now()))
            .filter(cleanup_effect::Column::EffectId.eq(&claim.effect_id))
            .filter(cleanup_effect::Column::LeaseOwner.eq(&self.lease_owner))
            .exec(&self.database)
            .await?;
        Ok(())
    }

    fn require_lease(&self, claim: &cleanup_effect::Model) -> Result<(), TerminalCleanupError> {
        if claim.state == "leased" && claim.lease_owner.as_deref() == Some(&self.lease_owner) {
            Ok(())
        } else {
            Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::EffectBusy,
                "Terminal cleanup lease is not held.",
            ))
        }
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn cleanup_checkpoint(
    checkpoints: &Arc<dyn CleanupCheckpoints>,
    checkpoint: CleanupCheckpoint,
) -> Result<(), ticketry_runs::persistence::RunsPersistenceError> {
    checkpoints.reached(checkpoint).map_err(|_| {
        ticketry_runs::persistence::RunsPersistenceError::new(
            ticketry_runs::persistence::RunsPersistenceErrorCode::Conflict,
            "Terminal cleanup stopped at an injected checkpoint.",
        )
    })
}
