//! Durable progression of a cleanup-pending Launch Effect.
//!
//! A cleanup-pending effect is the record of a launch that failed while an
//! external runtime might still exist. Nothing here deletes an authoritative
//! row: cleanup either becomes provably complete, or the effect stays
//! cleanup-pending with fresh evidence for the next reconciliation pass.

use chrono::Utc;
use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde_json::{json, Value};

use super::entities::launch_effect as launch_effect_entity;
use super::launch_claim::database_uuid;
use super::repositories::launch_effect;
use super::{timestamp, EffectService, LaunchEffectRecord, RunsPersistenceError};

/// What one cleanup pass proved about the external runtime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CleanupProgress {
    /// No runtime survives the failed launch. The effect becomes a settled
    /// failure and stops being reconciled.
    Complete,
    /// A runtime survives, or the observation was inconclusive. The effect
    /// keeps its cleanup-pending state and records why.
    Pending { evidence: Value },
}

impl EffectService {
    /// Record one cleanup observation against a cleanup-pending effect. An
    /// effect in any other state is returned untouched, so a repeated pass
    /// after cleanup finished is a no-op rather than a conflict.
    pub async fn record_cleanup_progress(
        &self,
        effect_id: &str,
        progress: CleanupProgress,
    ) -> Result<LaunchEffectRecord, RunsPersistenceError> {
        let effect_id = database_uuid(effect_id);
        let observed_at = timestamp::database_format(Utc::now());
        let transaction = self.database().begin().await?;
        let update = launch_effect_entity::Entity::update_many()
            .filter(launch_effect_entity::Column::EffectId.eq(&effect_id))
            .filter(launch_effect_entity::Column::State.eq("cleanup_pending"))
            .col_expr(
                launch_effect_entity::Column::UpdatedAt,
                Expr::value(observed_at.clone()),
            );
        let update = match &progress {
            CleanupProgress::Complete => update
                .col_expr(launch_effect_entity::Column::State, Expr::value("failed"))
                .col_expr(
                    launch_effect_entity::Column::RuntimeEvidence,
                    Expr::value(
                        json!({ "cleanup": "complete", "observedAt": observed_at }).to_string(),
                    ),
                ),
            CleanupProgress::Pending { evidence } => update.col_expr(
                launch_effect_entity::Column::RuntimeEvidence,
                Expr::value(
                    json!({
                        "cleanup": "pending",
                        "observedAt": observed_at,
                        "observation": evidence,
                    })
                    .to_string(),
                ),
            ),
        };
        update.exec(&transaction).await?;
        let effect = launch_effect_entity::Entity::find_by_id(&effect_id)
            .one(&transaction)
            .await?
            .map(launch_effect)
            .ok_or_else(super::launch_outcome::missing_effect)?;
        transaction.commit().await?;
        Ok(effect)
    }
}
