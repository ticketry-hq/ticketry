use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, ExprTrait,
    QueryFilter, Set, TransactionTrait,
};

use super::fractional_rank;
use super::identifiers::database_uuid;
use super::CommandError;
use crate::work_management::entities::{issue, project};

#[derive(Debug, Clone)]
pub struct ReparentWorkItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub before_id: Option<String>,
    pub after_id: Option<String>,
}

pub async fn reparent(
    database: &DatabaseConnection,
    input: ReparentWorkItem,
) -> Result<String, CommandError> {
    let id = database_uuid(&input.id, "id")?;
    let parent_id = optional_uuid(input.parent_id, "parent_id")?;
    let before_id = optional_uuid(input.before_id, "before_id")?;
    let after_id = optional_uuid(input.after_id, "after_id")?;
    if parent_id.as_ref() == Some(&id) {
        return Err(CommandError::validation(
            "A work item cannot be its own parent.",
        ));
    }
    if before_id.as_ref() == Some(&id) || after_id.as_ref() == Some(&id) {
        return Err(CommandError::validation(
            "A work item cannot be its own rank neighbor.",
        ));
    }

    let candidate = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let transaction = database.begin().await?;
    lock_project(&transaction, &candidate.project_id).await?;
    let current = issue::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let descendants = descendants(&transaction, &id).await?;
    if parent_id
        .as_ref()
        .is_some_and(|parent| descendants.contains(parent))
    {
        return Err(CommandError::validation(
            "A work item cannot be parented beneath its descendant.",
        ));
    }

    let parent = match parent_id.as_deref() {
        Some(parent_id) => Some(
            issue::Entity::find_by_id(parent_id)
                .one(&transaction)
                .await?
                .ok_or_else(|| CommandError::NotFound("Parent work item not found.".to_owned()))?,
        ),
        None => None,
    };
    if parent
        .as_ref()
        .is_some_and(|parent| parent.project_id != current.project_id)
    {
        return Err(CommandError::validation(
            "Parent work item belongs to another project.",
        ));
    }
    let module_id = derived_module(&transaction, parent.as_ref()).await?;
    let rank = destination_rank(
        &transaction,
        &current,
        parent_id.as_deref(),
        before_id.as_deref(),
        after_id.as_deref(),
    )
    .await?;
    if current.parent_id == parent_id && rank.as_ref().is_none_or(|rank| rank == &current.rank) {
        transaction.commit().await?;
        return Ok(id);
    }

    let revision = next_revision(&transaction, &current.project_id).await?;
    let mut moved = current.clone();
    let mut active: issue::ActiveModel = current.into();
    active.parent_id = Set(parent_id);
    active.module_id = Set(module_id.clone());
    if let Some(rank) = rank {
        moved.rank = rank.clone();
        active.rank = Set(rank);
    }
    moved.module_id = module_id;
    active.state_revision = Set(revision);
    active.updated_at = Set(super::timestamp::now());
    active.update(&transaction).await?;
    repair_descendant_modules(&transaction, moved).await?;
    transaction.commit().await?;
    Ok(id)
}

fn optional_uuid(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, CommandError> {
    value.map(|value| database_uuid(&value, field)).transpose()
}

async fn descendants<C: ConnectionTrait>(
    database: &C,
    root_id: &str,
) -> Result<HashSet<String>, CommandError> {
    let mut found = HashSet::new();
    let mut frontier = vec![root_id.to_owned()];
    while !frontier.is_empty() {
        let children = issue::Entity::find()
            .filter(issue::Column::ParentId.is_in(frontier))
            .all(database)
            .await?;
        frontier = children
            .into_iter()
            .filter_map(|child| found.insert(child.id.clone()).then_some(child.id))
            .collect();
    }
    Ok(found)
}

async fn derived_module<C: ConnectionTrait>(
    database: &C,
    parent: Option<&issue::Model>,
) -> Result<Option<String>, CommandError> {
    let Some(parent) = parent else {
        return Ok(None);
    };
    if parent.r#type == "module" {
        return Ok(Some(parent.id.clone()));
    }
    let Some(module_id) = &parent.module_id else {
        return Ok(None);
    };
    let module = issue::Entity::find_by_id(module_id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::validation("Parent has a stale module ancestor."))?;
    if module.r#type != "module" || module.project_id != parent.project_id {
        return Err(CommandError::validation(
            "Parent has an invalid module ancestor.",
        ));
    }
    Ok(Some(module.id))
}

async fn repair_descendant_modules<C: ConnectionTrait>(
    database: &C,
    root: issue::Model,
) -> Result<(), CommandError> {
    let mut frontier = vec![root];
    while !frontier.is_empty() {
        let parents: HashMap<String, Option<String>> = frontier
            .iter()
            .map(|parent| {
                let module = if parent.r#type == "module" {
                    Some(parent.id.clone())
                } else {
                    parent.module_id.clone()
                };
                (parent.id.clone(), module)
            })
            .collect();
        let mut children = issue::Entity::find()
            .filter(issue::Column::ParentId.is_in(parents.keys().cloned()))
            .all(database)
            .await?;
        for child in &mut children {
            let module_id =
                parents[child.parent_id.as_ref().expect("queried child has parent")].clone();
            if child.module_id != module_id {
                let mut active: issue::ActiveModel = child.clone().into();
                active.module_id = Set(module_id.clone());
                active.update(database).await?;
                child.module_id = module_id;
            }
        }
        frontier = children;
    }
    Ok(())
}

async fn destination_rank<C: ConnectionTrait>(
    database: &C,
    moved: &issue::Model,
    parent_id: Option<&str>,
    before_id: Option<&str>,
    after_id: Option<&str>,
) -> Result<Option<String>, CommandError> {
    if before_id.is_none() && after_id.is_none() {
        return Ok(None);
    }
    let before = rank_neighbor(database, moved, parent_id, before_id).await?;
    let after = rank_neighbor(database, moved, parent_id, after_id).await?;
    fractional_rank::between(
        before.as_ref().and_then(nonempty_rank),
        after.as_ref().and_then(nonempty_rank),
    )
    .map(Some)
    .map_err(|_| CommandError::validation("before/after are not ordered neighbors."))
}

async fn rank_neighbor<C: ConnectionTrait>(
    database: &C,
    moved: &issue::Model,
    parent_id: Option<&str>,
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
    } else if neighbor.r#type == "module" || neighbor.parent_id.as_deref() != parent_id {
        return Err(CommandError::validation(
            "A task rank neighbor must be a sibling at the destination.",
        ));
    }
    Ok(Some(neighbor))
}

fn nonempty_rank(row: &issue::Model) -> Option<&str> {
    (!row.rank.is_empty()).then_some(row.rank.as_str())
}

async fn lock_project<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<(), CommandError> {
    project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            sea_orm::sea_query::Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(project_id))
        .exec(database)
        .await?;
    Ok(())
}

async fn next_revision<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<i64, CommandError> {
    let row = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            sea_orm::sea_query::Expr::col(project::Column::StateRevision).add(1),
        )
        .col_expr(
            project::Column::UpdatedAt,
            sea_orm::sea_query::Expr::current_timestamp(),
        )
        .filter(project::Column::Id.eq(project_id))
        .exec_with_returning(database)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    Ok(row.state_revision)
}
