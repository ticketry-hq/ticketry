//! The durable launch backlog: which effects a restart still owes an answer.
//!
//! Only three shapes can outlive a crash — a prepared effect nobody claimed, a
//! claim whose lease expired, and a failure whose cleanup was never proven.
//! Applied and settled failures are finished and are never re-read here.

use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};

use super::entities::launch_effect as launch_effect_entity;
use super::repositories::launch_effect;
use super::{timestamp, LaunchEffectRecord, RunsPersistenceError};

pub async fn due(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<LaunchEffectRecord>, RunsPersistenceError> {
    let now = timestamp::database_now();
    let backlog = Condition::any()
        .add(launch_effect_entity::Column::State.eq("prepared"))
        .add(launch_effect_entity::Column::State.eq("cleanup_pending"))
        .add(
            Condition::all()
                .add(launch_effect_entity::Column::State.eq("leased"))
                .add(launch_effect_entity::Column::LeaseExpiresAt.lt(now)),
        );
    Ok(launch_effect_entity::Entity::find()
        .filter(backlog)
        .order_by_asc(launch_effect_entity::Column::CreatedAt)
        .order_by_asc(launch_effect_entity::Column::EffectId)
        .limit(limit)
        .all(database)
        .await?
        .into_iter()
        .map(launch_effect)
        .collect())
}
