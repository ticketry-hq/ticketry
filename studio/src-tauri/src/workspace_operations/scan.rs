//! The durable backlog: which operations a restart still owes an answer.
//!
//! Only three shapes can outlive a crash — a prepared operation nobody
//! claimed, a claim whose lease expired, and a failure whose cleanup was never
//! proven. Applied, conflicted, and settled failures are finished and are
//! never re-read here.

use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};

use super::entities::operation as operation_entity;
use super::records::operation;
use super::{timestamp, WorkspaceOperationError, WorkspaceOperationRecord};

pub(crate) async fn due(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<WorkspaceOperationRecord>, WorkspaceOperationError> {
    let now = timestamp::database_now();
    let backlog = Condition::any()
        .add(operation_entity::Column::State.eq("prepared"))
        .add(operation_entity::Column::State.eq("cleanup_pending"))
        .add(
            Condition::all()
                .add(operation_entity::Column::State.eq("leased"))
                .add(operation_entity::Column::LeaseExpiresAt.lt(now)),
        );
    Ok(operation_entity::Entity::find()
        .filter(backlog)
        .order_by_asc(operation_entity::Column::CreatedAt)
        .order_by_asc(operation_entity::Column::OperationId)
        .limit(limit)
        .all(database)
        .await?
        .into_iter()
        .map(operation)
        .collect())
}
