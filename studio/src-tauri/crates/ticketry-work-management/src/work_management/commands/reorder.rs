use std::collections::{HashMap, HashSet};

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DatabaseTransaction, EntityTrait, JoinType, QueryFilter, QuerySelect, RelationTrait, Set,
    TransactionTrait,
};

use super::fractional_rank;
use super::identifiers::database_uuid;
use super::status_facts::{
    record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity,
};
use super::CommandError;
use ticketry_entities::work_management::{issue, module_presentation, project};

#[derive(Debug, Clone)]
pub struct ReorderWorkItem {
    pub id: String,
    pub before_id: Option<String>,
    pub after_id: Option<String>,
    pub initial_order_ids: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReorderKind {
    Module,
    Task,
}

pub async fn reorder_work_item(
    database: &DatabaseConnection,
    input: ReorderWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    reorder(database, input, facts, ReorderKind::Task).await
}

pub async fn reorder_module_presentation(
    database: &DatabaseConnection,
    input: ReorderWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    reorder(database, input, facts, ReorderKind::Module).await
}

async fn reorder(
    database: &DatabaseConnection,
    input: ReorderWorkItem,
    facts: Option<&WorkFactRecorder>,
    kind: ReorderKind,
) -> Result<String, CommandError> {
    ticketry_diagnostics::record_story_move(
        "info",
        "backend-reorder-started",
        serde_json::json!({
            "kind": format!("{kind:?}").to_lowercase(),
            "id": input.id,
            "before_id": input.before_id,
            "after_id": input.after_id,
            "initial_order_ids": input.initial_order_ids,
        }),
    );
    let id = database_uuid(&input.id, "id")?;
    let initial = input
        .initial_order_ids
        .map(|ids| {
            ids.into_iter()
                .map(|id| database_uuid(&id, "initial_order_ids"))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let before_id = input
        .before_id
        .map(|id| database_uuid(&id, "before_id"))
        .transpose()?;
    let after_id = input
        .after_id
        .map(|id| database_uuid(&id, "after_id"))
        .transpose()?;

    let candidate = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .filter(|row| matches_kind(row, kind))
        .ok_or_else(|| {
            CommandError::NotFound(
                match kind {
                    ReorderKind::Module => "Module not found.",
                    ReorderKind::Task => "Work item not found.",
                }
                .to_owned(),
            )
        })?;
    ticketry_diagnostics::record_story_move(
        "info",
        "backend-reorder-candidate-loaded",
        serde_json::json!({
            "id": candidate.id,
            "project_id": candidate.project_id,
            "module_id": candidate.module_id,
            "parent_id": candidate.parent_id,
            "state_id": candidate.state_id,
            "rank": candidate.rank,
            "is_archived": candidate.is_archived,
        }),
    );
    let transaction = database.begin().await?;
    // Reserve the SQLite writer slot before reading ranks. This is the local
    // equivalent of locking the project row for both first and later drags.
    lock_project(&transaction, &candidate.project_id).await?;
    let current = issue::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .filter(|row| matches_kind(row, kind))
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;

    if kind == ReorderKind::Module {
        reorder_module(
            &transaction,
            &current,
            before_id.as_deref(),
            after_id.as_deref(),
            initial.as_deref(),
            facts,
        )
        .await?;
    } else {
        if initial.as_ref().is_some_and(|ids| !ids.is_empty()) {
            return Err(CommandError::validation(
                "initial_order_ids applies only to module work items.",
            ));
        }
        reorder_task(
            &transaction,
            current,
            before_id.as_deref(),
            after_id.as_deref(),
            facts,
        )
        .await?;
    }

    transaction.commit().await?;
    ticketry_diagnostics::record_story_move(
        "info",
        "backend-reorder-committed",
        serde_json::json!({"id": id}),
    );
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

async fn reorder_module(
    database: &DatabaseTransaction,
    current: &issue::Model,
    before_id: Option<&str>,
    after_id: Option<&str>,
    initial_order_ids: Option<&[String]>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    if before_id.is_none() && after_id.is_none() {
        return Err(CommandError::validation(
            "A module reorder requires at least one neighbor.",
        ));
    }
    if current.is_archived {
        return Err(CommandError::validation(
            "An archived module cannot be reordered.",
        ));
    }
    if !has_manual_module_order(database, &current.project_id).await? {
        seed_manual_order(database, &current.project_id, initial_order_ids).await?;
    }
    validate_module_gap(database, current, before_id, after_id).await?;
    let before = module_neighbor(database, current, before_id).await?;
    let after = module_neighbor(database, current, after_id).await?;
    let rank = fractional_rank::between(
        before.as_ref().and_then(nonempty_presentation_rank),
        after.as_ref().and_then(nonempty_presentation_rank),
    )
    .map_err(|_| CommandError::validation("before/after are not ordered neighbors."))?;
    let presentation = module_presentation::Entity::find_by_id(&current.id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::validation("The reordered module has no rank."))?;
    if presentation.rank == rank {
        return Ok(());
    }

    let mut active: module_presentation::ActiveModel = presentation.into();
    active.rank = Set(rank);
    active.update(database).await?;
    record_revision(database, current.clone(), facts).await
}

async fn reorder_task(
    database: &DatabaseTransaction,
    current: issue::Model,
    before_id: Option<&str>,
    after_id: Option<&str>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let before = task_neighbor(database, &current, before_id).await?;
    let after = task_neighbor(database, &current, after_id).await?;
    ticketry_diagnostics::record_story_move(
        "info",
        "backend-reorder-neighbors-loaded",
        serde_json::json!({
            "id": current.id,
            "current_rank": current.rank,
            "before": before.as_ref().map(|row| serde_json::json!({
                "id": row.id,
                "rank": row.rank,
                "state_id": row.state_id,
                "parent_id": row.parent_id,
                "module_id": row.module_id,
            })),
            "after": after.as_ref().map(|row| serde_json::json!({
                "id": row.id,
                "rank": row.rank,
                "state_id": row.state_id,
                "parent_id": row.parent_id,
                "module_id": row.module_id,
            })),
        }),
    );
    let rank = match fractional_rank::between(
        before.as_ref().and_then(nonempty_issue_rank),
        after.as_ref().and_then(nonempty_issue_rank),
    ) {
        Ok(rank) => rank,
        Err(())
            if before
                .as_ref()
                .zip(after.as_ref())
                .is_some_and(|(before, after)| before.rank == after.rank) =>
        {
            ticketry_diagnostics::record_story_move(
                "warn",
                "backend-reorder-duplicate-ranks",
                serde_json::json!({
                    "id": current.id,
                    "before_id": before_id,
                    "after_id": after_id,
                    "rank": before.as_ref().map(|row| &row.rank),
                }),
            );
            return repair_duplicate_task_ranks(database, current, before_id, after_id, facts)
                .await;
        }
        Err(()) => {
            return Err(CommandError::validation(
                "before/after are not ordered neighbors.",
            ));
        }
    };
    ticketry_diagnostics::record_story_move(
        "info",
        "backend-reorder-rank-computed",
        serde_json::json!({"id": current.id, "old_rank": current.rank, "new_rank": rank}),
    );
    if rank == current.rank {
        return Ok(());
    }
    let mut active: issue::ActiveModel = current.clone().into();
    active.rank = Set(rank);
    save_revision(database, current, active, facts).await
}

async fn repair_duplicate_task_ranks(
    database: &DatabaseTransaction,
    current: issue::Model,
    before_id: Option<&str>,
    after_id: Option<&str>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let mut query = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&current.project_id))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false));
    query = match &current.module_id {
        Some(module_id) => query.filter(issue::Column::ModuleId.eq(module_id)),
        None => query.filter(issue::Column::ModuleId.is_null()),
    };
    query = match &current.parent_id {
        Some(parent_id) => query.filter(issue::Column::ParentId.eq(parent_id)),
        None => query.filter(issue::Column::ParentId.is_null()),
    };
    query = match &current.state_id {
        Some(state_id) => query.filter(issue::Column::StateId.eq(state_id)),
        None => query.filter(issue::Column::StateId.is_null()),
    };

    let mut siblings = query.all(database).await?;
    siblings.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| right.sequence_id.cmp(&left.sequence_id))
            .then_with(|| right.id.cmp(&left.id))
    });
    siblings.retain(|row| row.id != current.id);

    let insertion = match (before_id, after_id) {
        (None, Some(after)) if siblings.first().is_some_and(|row| row.id == after) => 0,
        (Some(before), None) if siblings.last().is_some_and(|row| row.id == before) => {
            siblings.len()
        }
        (Some(before), Some(after)) => siblings
            .windows(2)
            .position(|rows| rows[0].id == before && rows[1].id == after)
            .map(|index| index + 1)
            .ok_or_else(|| CommandError::validation("before/after are not ordered neighbors."))?,
        _ => {
            return Err(CommandError::validation(
                "before/after are not ordered neighbors.",
            ));
        }
    };
    siblings.insert(insertion, current.clone());

    let ranks = fractional_rank::rebalance(siblings.len());
    for (row, rank) in siblings.into_iter().zip(ranks) {
        if row.id == current.id {
            let mut active: issue::ActiveModel = row.clone().into();
            active.rank = Set(rank);
            save_revision(database, row, active, facts).await?;
        } else if row.rank != rank {
            let mut active: issue::ActiveModel = row.into();
            active.rank = Set(rank);
            active.update(database).await?;
        }
    }
    Ok(())
}

async fn record_revision(
    database: &DatabaseTransaction,
    current: issue::Model,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    save_revision(database, current.clone(), current.into(), facts).await
}

async fn save_revision(
    database: &DatabaseTransaction,
    current: issue::Model,
    mut active: issue::ActiveModel,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let revision = next_revision(database, &current.project_id).await?;
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    active.state_revision = Set(revision);
    active.updated_at = Set(now.clone());
    active.update(database).await?;
    record_work_item(
        facts,
        database,
        WorkItemIdentity::of(&current).fact(WorkItemChange::Reordered, revision, &occurred_at),
    )
    .await
}

fn matches_kind(row: &issue::Model, kind: ReorderKind) -> bool {
    (row.r#type == "module") == (kind == ReorderKind::Module)
}

async fn has_manual_module_order<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<bool, CommandError> {
    Ok(module_presentation::Entity::find()
        .join(
            JoinType::InnerJoin,
            module_presentation::Relation::Module.def(),
        )
        .filter(issue::Column::ProjectId.eq(project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(module_presentation::Column::Rank.ne(""))
        .one(database)
        .await?
        .is_some())
}

async fn seed_manual_order<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
    initial_order_ids: Option<&[String]>,
) -> Result<(), CommandError> {
    let Some(ordered) = initial_order_ids.filter(|ids| !ids.is_empty()) else {
        return Err(CommandError::validation(
            "The first module reorder requires the visible module order.",
        ));
    };
    let unique: HashSet<&str> = ordered.iter().map(String::as_str).collect();
    if unique.len() != ordered.len() {
        return Err(CommandError::validation(
            "The module order baseline repeats a module.",
        ));
    }
    let active = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(issue::Column::IsArchived.eq(false))
        .all(database)
        .await?;
    let active_ids: HashSet<&str> = active.iter().map(|row| row.id.as_str()).collect();
    if unique != active_ids {
        return Err(CommandError::validation(
            "The module order baseline must list exactly this project's active modules.",
        ));
    }
    let mut presentations: HashMap<String, module_presentation::Model> =
        module_presentation::Entity::find()
            .filter(module_presentation::Column::ModuleId.is_in(ordered.to_vec()))
            .all(database)
            .await?
            .into_iter()
            .map(|row| (row.module_id.clone(), row))
            .collect();
    for (module_id, rank) in ordered
        .iter()
        .zip(fractional_rank::rebalance(ordered.len()))
    {
        if let Some(row) = presentations.remove(module_id) {
            let mut active: module_presentation::ActiveModel = row.into();
            active.rank = Set(rank);
            active.update(database).await?;
        } else {
            module_presentation::ActiveModel {
                module_id: Set(module_id.clone()),
                rank: Set(rank),
                tab_hidden: Set(false),
            }
            .insert(database)
            .await?;
        }
    }
    Ok(())
}

async fn validate_module_gap<C: ConnectionTrait>(
    database: &C,
    moved: &issue::Model,
    before_id: Option<&str>,
    after_id: Option<&str>,
) -> Result<(), CommandError> {
    let mut rows = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&moved.project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(issue::Column::IsArchived.eq(false))
        .find_also_related(module_presentation::Entity)
        .all(database)
        .await?;
    if rows.iter().any(|(_, presentation)| {
        presentation
            .as_ref()
            .is_none_or(|presentation| presentation.rank.is_empty())
    }) {
        return Err(CommandError::validation(
            "A module order neighbor has no rank.",
        ));
    }
    rows.sort_by(|(left, left_rank), (right, right_rank)| {
        left_rank
            .as_ref()
            .unwrap()
            .rank
            .cmp(&right_rank.as_ref().unwrap().rank)
            .then_with(|| left.id.cmp(&right.id))
    });
    let remaining: Vec<&str> = rows
        .iter()
        .map(|(module, _)| module.id.as_str())
        .filter(|id| *id != moved.id)
        .collect();
    let valid = match (before_id, after_id) {
        (None, Some(after)) => remaining.first().is_some_and(|id| *id == after),
        (Some(before), None) => remaining.last().is_some_and(|id| *id == before),
        (Some(before), Some(after)) => remaining.windows(2).any(|window| window == [before, after]),
        (None, None) => false,
    };
    if !valid {
        return Err(CommandError::validation(
            "before/after are not ordered neighbors.",
        ));
    }
    Ok(())
}

async fn module_neighbor<C: ConnectionTrait>(
    database: &C,
    moved: &issue::Model,
    id: Option<&str>,
) -> Result<Option<module_presentation::Model>, CommandError> {
    let Some(id) = id else { return Ok(None) };
    let neighbor = issue::Entity::find_by_id(id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Neighbor not found.".to_owned()))?;
    if neighbor.project_id != moved.project_id {
        return Err(CommandError::validation(
            "Neighbor belongs to another project.",
        ));
    }
    if neighbor.r#type != "module" {
        return Err(CommandError::validation(
            "A module may only be ranked against modules.",
        ));
    }
    if neighbor.is_archived {
        return Err(CommandError::validation(
            "An archived module is not a drop neighbor.",
        ));
    }
    module_presentation::Entity::find_by_id(id)
        .one(database)
        .await?
        .map(Some)
        .ok_or_else(|| CommandError::validation("A module order neighbor has no rank."))
}

async fn task_neighbor<C: ConnectionTrait>(
    database: &C,
    moved: &issue::Model,
    id: Option<&str>,
) -> Result<Option<issue::Model>, CommandError> {
    let Some(id) = id else { return Ok(None) };
    let neighbor = issue::Entity::find_by_id(id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Neighbor not found.".to_owned()))?;
    if neighbor.project_id != moved.project_id {
        return Err(CommandError::validation(
            "Neighbor belongs to another project.",
        ));
    }
    if neighbor.r#type == "module" {
        return Err(CommandError::validation(
            "A task may not be ranked against a module.",
        ));
    }
    Ok(Some(neighbor))
}

fn nonempty_presentation_rank(row: &module_presentation::Model) -> Option<&str> {
    (!row.rank.is_empty()).then_some(row.rank.as_str())
}

fn nonempty_issue_rank(row: &issue::Model) -> Option<&str> {
    (!row.rank.is_empty()).then_some(row.rank.as_str())
}

async fn lock_project<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<(), CommandError> {
    let locked = project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(project_id))
        .exec(database)
        .await?;
    if locked.rows_affected == 0 {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    Ok(())
}

async fn next_revision<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<i64, CommandError> {
    super::work_items::next_revision(database, project_id).await
}
