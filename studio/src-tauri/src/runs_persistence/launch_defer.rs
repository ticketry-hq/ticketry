//! Safe release of a claimed effect when observation cannot authorize work.

use chrono::Utc;
use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde_json::Value;

use super::entities::launch_effect as launch_effect_entity;
use super::launch_claim::{database_uuid, validate_owner};
use super::repositories::launch_effect;
use super::{
    timestamp, EffectService, LaunchEffectRecord, RunsPersistenceError, RunsPersistenceErrorCode,
};

impl EffectService {
    /// Return one live claim to `prepared` without changing its Agent Run or
    /// status facts. Every later attempt still has to inspect before acting.
    pub(crate) async fn defer_claim(
        &self,
        effect_id: &str,
        lease_owner: &str,
        code: &str,
        message: &str,
        evidence: Value,
    ) -> Result<LaunchEffectRecord, RunsPersistenceError> {
        validate_owner(lease_owner)?;
        if code.trim().is_empty() || code.len() > 64 || message.len() > 2000 {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidLaunchIntent,
                "A deferred launch requires bounded diagnostic fields.",
            ));
        }
        let effect_id = database_uuid(effect_id);
        let transaction = self.database().begin().await?;
        let changed = launch_effect_entity::Entity::update_many()
            .col_expr(launch_effect_entity::Column::State, Expr::value("prepared"))
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
                Expr::value(code),
            )
            .col_expr(
                launch_effect_entity::Column::LastErrorMessage,
                Expr::value(message),
            )
            .col_expr(
                launch_effect_entity::Column::RuntimeEvidence,
                Expr::value(evidence.to_string()),
            )
            .col_expr(
                launch_effect_entity::Column::UpdatedAt,
                Expr::value(timestamp::database_format(Utc::now())),
            )
            .filter(launch_effect_entity::Column::EffectId.eq(&effect_id))
            .filter(launch_effect_entity::Column::State.eq("leased"))
            .filter(launch_effect_entity::Column::LeaseOwner.eq(lease_owner))
            .exec(&transaction)
            .await?
            .rows_affected;
        if changed != 1 {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::LaunchLeaseNotHeld,
                "The deferred launch requires the reporter's live lease.",
            ));
        }
        let effect = launch_effect_entity::Entity::find_by_id(&effect_id)
            .one(&transaction)
            .await?
            .map(launch_effect)
            .ok_or_else(super::launch_outcome::missing_effect)?;
        transaction.commit().await?;
        Ok(effect)
    }

    pub(crate) async fn due(
        &self,
        limit: u64,
    ) -> Result<Vec<LaunchEffectRecord>, RunsPersistenceError> {
        super::launch_scan::due(self.database(), limit).await
    }
}
