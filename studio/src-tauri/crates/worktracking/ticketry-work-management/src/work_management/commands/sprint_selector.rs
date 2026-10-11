//! Resolve sprint membership selectors inside the owning write transaction.

use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, QueryOrder};
use ticketry_entities::sprint;

use super::{sprints::open_sprint, CommandError};

/// A project-scoped target for a Work Item's sprint membership.
#[derive(Debug, Clone)]
pub enum SprintSelector {
    Current,
    Next,
    Explicit(String),
}

pub(super) async fn resolve(
    transaction: &DatabaseTransaction,
    project_id: &str,
    selector: SprintSelector,
) -> Result<sprint::Model, CommandError> {
    match selector {
        SprintSelector::Explicit(id) => open_sprint(transaction, &id, project_id).await,
        SprintSelector::Next => sprint::Entity::find()
            .filter(sprint::Column::ProjectId.eq(project_id))
            .filter(sprint::Column::Status.eq(ticketry_entities::SPRINT_PLANNED))
            .order_by_asc(sprint::Column::Rank)
            .order_by_asc(sprint::Column::Id)
            .one(transaction)
            .await?
            .ok_or_else(|| CommandError::Rejected {
                message: "The project has no planned sprint.".to_owned(),
                code: "no_next_sprint",
                field: Some("sprint"),
            }),
        SprintSelector::Current => {
            let mut active = sprint::Entity::find()
                .filter(sprint::Column::ProjectId.eq(project_id))
                .filter(sprint::Column::Status.eq(ticketry_entities::SPRINT_ACTIVE))
                .all(transaction)
                .await?;
            if active.len() != 1 {
                return Err(CommandError::Rejected {
                    message: "The project has no single active sprint.".to_owned(),
                    code: "no_active_sprint",
                    field: Some("sprint"),
                });
            }
            Ok(active.remove(0))
        }
    }
}
