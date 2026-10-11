//! Neighbor-identity Sprint moves within one locked project sequence.

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, QuerySelect, QueryTrait, Set, TransactionTrait,
};
use ticketry_entities::{project, sprint, SPRINT_PLANNED};

use super::{
    fractional_rank,
    identifiers::database_uuid,
    sprint_sequence,
    status_facts::{record_sprint_reorder, stamp, WorkFactRecorder},
    timestamp,
    work_items::next_revision,
    CommandError,
};

pub(crate) async fn reorder_sprint(
    database: &DatabaseConnection,
    sprint_id: &str,
    before_id: Option<String>,
    after_id: Option<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<sprint::Model, CommandError> {
    let id = database_uuid(sprint_id, "sprint_id")?;
    let before = before_id
        .map(|id| database_uuid(&id, "before_id"))
        .transpose()?;
    let after = after_id
        .map(|id| database_uuid(&id, "after_id"))
        .transpose()?;
    if before.is_none() && after.is_none() {
        return Err(CommandError::validation(
            "A sprint reorder requires at least one neighbor.",
        ));
    }
    let transaction = database.begin().await?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(
            project::Column::Id.in_subquery(
                sprint::Entity::find()
                    .select_only()
                    .column(sprint::Column::ProjectId)
                    .filter(sprint::Column::Id.eq(&id))
                    .into_query(),
            ),
        )
        .exec(&transaction)
        .await?;
    let current = sprint::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint not found.".to_owned()))?;
    if current.status != SPRINT_PLANNED {
        return Err(CommandError::validation(
            "Only planned sprints can be reordered.",
        ));
    }
    let mut sequence = sprint_sequence::ordered(&transaction, &current.project_id).await?;
    let original = sequence.iter().position(|row| row.id == id).unwrap();
    let unchanged = current;
    let current = sequence.remove(original);
    let insertion = match (before.as_deref(), after.as_deref()) {
        (None, Some(after)) if sequence.first().is_some_and(|row| row.id == after) => 0,
        (Some(before), None) if sequence.last().is_some_and(|row| row.id == before) => {
            sequence.len()
        }
        (Some(before), Some(after)) => sequence
            .windows(2)
            .position(|rows| rows[0].id == before && rows[1].id == after)
            .map(|index| index + 1)
            .ok_or_else(|| {
                CommandError::validation("before/after are not ordered sprint neighbors.")
            })?,
        _ => {
            return Err(CommandError::validation(
                "before/after are not ordered sprint neighbors.",
            ))
        }
    };
    if sequence[insertion..]
        .iter()
        .any(|row| row.status != SPRINT_PLANNED)
    {
        return Err(CommandError::validation(
            "A planned sprint cannot be moved before sprint history.",
        ));
    }
    if insertion == original {
        // A retry is a true no-op, including any tentative duplicate repair.
        transaction.rollback().await?;
        return Ok(unchanged);
    }
    let rank = fractional_rank::between(
        insertion
            .checked_sub(1)
            .map(|index| sequence[index].rank.as_str()),
        sequence.get(insertion).map(|row| row.rank.as_str()),
    )
    .map_err(|_| CommandError::validation("A sprint order neighbor has an invalid rank."))?;
    let revision = next_revision(&transaction, &current.project_id).await?;
    let now = timestamp::now();
    let mut active = current.into_active_model();
    active.rank = Set(rank);
    active.updated_at = Set(now);
    let moved = active.update(&transaction).await?;
    record_sprint_reorder(facts, &transaction, &moved, revision, &stamp(now)).await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(moved)
}
