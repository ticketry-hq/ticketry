use std::collections::{HashMap, HashSet};

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QuerySelect, QueryTrait, Set, TransactionTrait,
};

use super::identifiers::database_uuid;
use super::CommandError;
use crate::entities::work_management::{issue, issue_blocker, project};

#[derive(Debug, Clone)]
pub enum BlockerChange {
    Replace {
        task_id: String,
        blocked_by_ids: Vec<String>,
    },
    Add {
        task_id: String,
        blocker_id: String,
    },
    Remove {
        task_id: String,
        blocker_id: String,
    },
}

pub async fn replace(
    database: &DatabaseConnection,
    task_id: &str,
    blocked_by_ids: Vec<String>,
) -> Result<String, CommandError> {
    change(
        database,
        BlockerChange::Replace {
            task_id: task_id.to_owned(),
            blocked_by_ids,
        },
    )
    .await
}

/// Apply one dependency change after reserving the project writer.
pub async fn change(
    database: &DatabaseConnection,
    change: BlockerChange,
) -> Result<String, CommandError> {
    let (task_id, requested, additive) = match change {
        BlockerChange::Replace {
            task_id,
            blocked_by_ids,
        } => (task_id, blocked_by_ids, None),
        BlockerChange::Add {
            task_id,
            blocker_id,
        } => (task_id, vec![blocker_id], Some(true)),
        BlockerChange::Remove {
            task_id,
            blocker_id,
        } => (task_id, vec![blocker_id], Some(false)),
    };
    let task_id = database_uuid(&task_id, "task_id")?;
    let requested = requested
        .iter()
        .map(|id| database_uuid(id, "blocked_by_ids"))
        .collect::<Result<Vec<_>, _>>()?;
    let unique = requested.iter().collect::<HashSet<_>>();
    if unique.len() != requested.len() {
        return Err(CommandError::DuplicateBlocker(
            "A blocker may be supplied only once.".to_owned(),
        ));
    }
    if requested.iter().any(|id| id == &task_id) {
        return Err(CommandError::SelfBlocker(
            "An issue cannot block itself.".to_owned(),
        ));
    }

    let transaction = database.begin().await?;
    // This is the transaction's first statement: reserve SQLite's writer
    // before any task or edge read so concurrent additive changes serialize.
    let reservation = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(
            project::Column::Id.in_subquery(
                issue::Entity::find()
                    .select_only()
                    .column(issue::Column::ProjectId)
                    .filter(issue::Column::Id.eq(&task_id))
                    .filter(issue::Column::Type.eq("task"))
                    .into_query(),
            ),
        )
        .exec(&transaction)
        .await?;
    if reservation.rows_affected == 0 {
        return Err(CommandError::NotFound("Work item not found.".to_owned()));
    }
    let task = issue::Entity::find_by_id(&task_id)
        .one(&transaction)
        .await?
        .filter(|row| row.r#type == "task")
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;

    let mut current = issue_blocker::Entity::find()
        .filter(issue_blocker::Column::FromIssueId.eq(&task_id))
        .all(&transaction)
        .await?
        .into_iter()
        .map(|edge| edge.to_issue_id)
        .collect::<Vec<_>>();
    current.sort();
    let persisted = current.clone();
    let mut blocked_by_ids = match additive {
        None => requested,
        Some(true) => {
            if !current.contains(&requested[0]) {
                current.push(requested[0].clone());
            }
            current
        }
        Some(false) => {
            current.retain(|id| id != &requested[0]);
            current
        }
    };
    blocked_by_ids.sort();
    if persisted == blocked_by_ids {
        transaction.commit().await?;
        return Ok(task_id);
    }

    let blockers = issue::Entity::find()
        .filter(issue::Column::Id.is_in(blocked_by_ids.clone()))
        .all(&transaction)
        .await?;
    if blockers.len() != blocked_by_ids.len() || blockers.iter().any(|row| row.r#type != "task") {
        return Err(CommandError::NotFound(
            "One or more blocker work items were not found.".to_owned(),
        ));
    }
    if blockers.iter().any(|row| row.project_id != task.project_id) {
        return Err(CommandError::ForeignScope(
            "Blocker work items must belong to the same project.".to_owned(),
        ));
    }

    let edges = issue_blocker::Entity::find().all(&transaction).await?;
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    for edge in edges {
        if edge.from_issue_id != task_id {
            graph
                .entry(edge.from_issue_id)
                .or_default()
                .push(edge.to_issue_id);
        }
    }
    graph.insert(task_id.clone(), blocked_by_ids.clone());
    if reaches(&graph, &task_id, &blocked_by_ids) {
        return Err(CommandError::BlockerCycle(
            "That blocker would create a cycle.".to_owned(),
        ));
    }

    issue_blocker::Entity::delete_many()
        .filter(issue_blocker::Column::FromIssueId.eq(&task_id))
        .exec(&transaction)
        .await?;
    for blocker_id in blocked_by_ids {
        issue_blocker::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            from_issue_id: Set(task_id.clone()),
            to_issue_id: Set(blocker_id),
        }
        .insert(&transaction)
        .await?;
    }
    let revision = super::work_items::next_revision(&transaction, &task.project_id).await?;
    let mut active: issue::ActiveModel = task.into();
    active.state_revision = Set(revision);
    active.updated_at = Set(super::timestamp::now());
    active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(task_id)
}

pub async fn list(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Vec<String>, CommandError> {
    let task_id = database_uuid(task_id, "task_id")?;
    let mut ids = issue_blocker::Entity::find()
        .filter(issue_blocker::Column::FromIssueId.eq(task_id))
        .all(database)
        .await?
        .into_iter()
        .map(|edge| edge.to_issue_id)
        .collect::<Vec<_>>();
    ids.sort();
    Ok(ids)
}

fn reaches(graph: &HashMap<String, Vec<String>>, target: &str, seeds: &[String]) -> bool {
    let mut frontier = seeds.to_vec();
    let mut visited = HashSet::new();
    while let Some(current) = frontier.pop() {
        if current == target {
            return true;
        }
        if visited.insert(current.clone()) {
            frontier.extend(graph.get(&current).into_iter().flatten().cloned());
        }
    }
    false
}
