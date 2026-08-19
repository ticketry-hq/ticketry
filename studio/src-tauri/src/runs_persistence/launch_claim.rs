//! Bounded compare-and-set claim over one prepared Launch Effect.
//!
//! A claim is the only way an executor learns which launch to perform, and it
//! hands over nothing but the two predetermined identities. Runtime policy is
//! resolved by the executor from approved sources, never carried here.

use chrono::{Duration, Utc};
use sea_orm::{
    sea_query::{Expr, ExprTrait},
    ColumnTrait, Condition, EntityTrait, QueryFilter, TransactionTrait,
};

use super::entities::launch_effect as launch_effect_entity;
use super::{timestamp, EffectService, RunsPersistenceError, RunsPersistenceErrorCode};

/// Everything an executor is allowed to receive. There is deliberately no
/// prompt, path, command, provider credential, or policy body on this type.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimedLaunch {
    pub effect_id: String,
    pub agent_run_id: String,
    pub lease_owner: String,
    pub lease_expires_at: String,
    pub attempt_count: i32,
}

/// Leases are bounded so a crashed executor cannot hold an effect forever;
/// expiry only makes the effect eligible for reconciliation.
pub const MAX_LEASE_SECONDS: i64 = 900;

impl EffectService {
    pub async fn claim(
        &self,
        effect_id: &str,
        lease_owner: &str,
        lease_seconds: i64,
    ) -> Result<ClaimedLaunch, RunsPersistenceError> {
        validate_owner(lease_owner)?;
        if !(1..=MAX_LEASE_SECONDS).contains(&lease_seconds) {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidLaunchIntent,
                "The launch lease duration is outside the supported bound.",
            ));
        }
        let effect_id = database_uuid(effect_id);
        let now = Utc::now();
        let claimed_at = timestamp::database_format(now);
        let expires_at = timestamp::database_format(now + Duration::seconds(lease_seconds));

        let transaction = self.database().begin().await?;
        // A prepared effect, or one whose lease has expired, is claimable. Any
        // other state loses the compare-and-set and is reported below from the
        // row that actually won.
        let claimable = Condition::any()
            .add(launch_effect_entity::Column::State.eq("prepared"))
            .add(
                Condition::all()
                    .add(launch_effect_entity::Column::State.eq("leased"))
                    .add(launch_effect_entity::Column::LeaseExpiresAt.lt(claimed_at.clone())),
            );
        let claimed = launch_effect_entity::Entity::update_many()
            .col_expr(launch_effect_entity::Column::State, Expr::value("leased"))
            .col_expr(
                launch_effect_entity::Column::LeaseOwner,
                Expr::value(lease_owner),
            )
            .col_expr(
                launch_effect_entity::Column::LeaseExpiresAt,
                Expr::value(expires_at.clone()),
            )
            .col_expr(
                launch_effect_entity::Column::AttemptCount,
                Expr::col(launch_effect_entity::Column::AttemptCount).add(1),
            )
            .col_expr(
                launch_effect_entity::Column::UpdatedAt,
                Expr::value(claimed_at),
            )
            .filter(launch_effect_entity::Column::EffectId.eq(&effect_id))
            .filter(claimable)
            .exec(&transaction)
            .await?
            .rows_affected
            == 1;
        let effect = launch_effect_entity::Entity::find_by_id(&effect_id)
            .one(&transaction)
            .await?
            .ok_or_else(|| {
                RunsPersistenceError::new(
                    RunsPersistenceErrorCode::LaunchEffectNotFound,
                    "The Launch Effect does not exist.",
                )
            })?;
        if !claimed {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::LaunchConflict,
                match effect.state.as_str() {
                    "applied" => "The Launch Effect has already been applied.",
                    "failed" | "cleanup_pending" => "The Launch Effect has already failed.",
                    _ => "The Launch Effect is leased by another executor.",
                },
            ));
        }
        transaction.commit().await?;
        Ok(ClaimedLaunch {
            effect_id: effect.effect_id,
            agent_run_id: effect.agent_run_id,
            lease_owner: lease_owner.to_owned(),
            lease_expires_at: expires_at,
            attempt_count: effect.attempt_count,
        })
    }
}

pub(crate) fn validate_owner(lease_owner: &str) -> Result<(), RunsPersistenceError> {
    if lease_owner.trim().is_empty()
        || lease_owner.len() > 255
        || lease_owner.chars().any(char::is_control)
    {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::InvalidLaunchIntent,
            "The launch lease owner is invalid.",
        ));
    }
    Ok(())
}

pub(crate) fn database_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
