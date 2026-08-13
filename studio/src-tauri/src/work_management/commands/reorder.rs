use std::collections::{HashMap, HashSet};

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::fractional_rank;
use super::identifiers::database_uuid;
use super::CommandError;
use crate::work_management::entities::{issue, project};

#[derive(Debug, Clone)]
pub struct ReorderWorkItem {
    pub id: String,
    pub before_id: Option<String>,
    pub after_id: Option<String>,
    pub initial_order_ids: Option<Vec<String>>,
}

pub async fn reorder(
    database: &DatabaseConnection,
    input: ReorderWorkItem,
) -> Result<String, CommandError> {
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
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let transaction = database.begin().await?;
    // Reserve the project's SQLite writer slot before reading ranks. This is
    // the equivalent of Django's select_for_update project lock.
    let locked_project = lock_project(&transaction, &candidate.project_id).await?;
    let current = issue::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    if current.r#type == "module" && before_id.is_none() && after_id.is_none() {
        return Err(CommandError::validation(
            "A module reorder requires at least one neighbor.",
        ));
    }
    if current.r#type == "module" && current.is_archived {
        return Err(CommandError::validation(
            "An archived module cannot be reordered.",
        ));
    }
    if current.r#type != "module" && initial.as_ref().is_some_and(|ids| !ids.is_empty()) {
        return Err(CommandError::validation(
            "initial_order_ids applies only to module work items.",
        ));
    }

    if current.r#type == "module" && !locked_project.manual_module_order {
        seed_manual_order(&transaction, &current.project_id, initial.as_deref()).await?;
        project::Entity::update_many()
            .col_expr(
                project::Column::ManualModuleOrder,
                sea_orm::sea_query::Expr::value(true),
            )
            .filter(project::Column::Id.eq(&current.project_id))
            .exec(&transaction)
            .await?;
    }

    let before = neighbor(&transaction, &current, before_id.as_deref()).await?;
    let after = neighbor(&transaction, &current, after_id.as_deref()).await?;
    let rank = fractional_rank::between(
        before.as_ref().and_then(nonempty_rank),
        after.as_ref().and_then(nonempty_rank),
    )
    .map_err(|_| CommandError::validation("before/after are not ordered neighbors."))?;

    if rank != current.rank {
        let revision = next_revision(&transaction, &current.project_id).await?;
        let mut active: issue::ActiveModel = current.into();
        active.rank = Set(rank);
        active.state_revision = Set(revision);
        active.updated_at = Set(super::timestamp::now());
        active.update(&transaction).await?;
    }
    transaction.commit().await?;
    Ok(id)
}

fn nonempty_rank(row: &issue::Model) -> Option<&str> {
    (!row.rank.is_empty()).then_some(row.rank.as_str())
}

async fn lock_project<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<project::Model, CommandError> {
    project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(project_id))
        .exec_with_returning(database)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    project::Entity::find_by_id(project_id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))
}

async fn next_revision<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<i64, CommandError> {
    super::work_items::next_revision(database, project_id).await
}

async fn neighbor<C: ConnectionTrait>(
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
    if moved.r#type == "module" {
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
    } else if neighbor.r#type == "module" {
        return Err(CommandError::validation(
            "A task may not be ranked against a module.",
        ));
    }
    Ok(Some(neighbor))
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
    let modules = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(issue::Column::IsArchived.eq(false))
        .order_by_desc(issue::Column::SequenceId)
        .order_by_asc(issue::Column::Id)
        .all(database)
        .await?;
    let active: HashSet<&str> = modules.iter().map(|row| row.id.as_str()).collect();
    if unique != active {
        return Err(CommandError::validation(
            "The module order baseline must list exactly this project's active modules.",
        ));
    }
    let mut modules_by_id: HashMap<String, issue::Model> = modules
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect();
    for (id, rank) in ordered
        .iter()
        .zip(fractional_rank::rebalance(ordered.len()))
    {
        let mut active: issue::ActiveModel = modules_by_id
            .remove(id)
            .expect("validated module baseline must resolve")
            .into();
        active.rank = Set(rank);
        active.update(database).await?;
    }
    Ok(())
}
