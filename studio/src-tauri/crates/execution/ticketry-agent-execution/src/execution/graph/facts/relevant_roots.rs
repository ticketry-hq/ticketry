use std::collections::{HashMap, HashSet};

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::execution::graph::{types::compact_id, GraphAccess, GraphFactsError};
use ticketry_entities::{
    graph_run, {issue, issue_blocker},
};

use super::work_item_facts::public_id;

pub async fn relevant_armed_roots(
    database: &impl ConnectionTrait,
    affected_work_item_id: &str,
    access: &GraphAccess,
) -> Result<Vec<String>, GraphFactsError> {
    let affected_id = compact_id(affected_work_item_id.to_owned());
    let Some(affected) = issue::Entity::find_by_id(&affected_id)
        .one(database)
        .await?
    else {
        return Ok(Vec::new());
    };
    let mut candidates = HashSet::from([affected.id.clone()]);
    if affected.r#type == "task" && !affected.is_archived {
        if let Some(parent_id) = affected.parent_id.clone() {
            candidates.insert(parent_id);
        }
    }
    candidates.extend(blocked_child_parents(database, &affected_id).await?);

    let candidate_ids = candidates.into_iter().collect::<Vec<_>>();
    let current_roots = current_roots(database, &candidate_ids).await?;
    let mut roots = graph_run::Entity::find()
        .filter(graph_run::Column::RootId.is_in(candidate_ids))
        .all(database)
        .await?
        .into_iter()
        .filter(|graph| {
            current_roots
                .get(&graph.root_id)
                .is_some_and(|project_id| project_id == &graph.project_id)
                && access.allows(&graph.project_id, &graph.root_id)
        })
        .map(|graph| public_id(&graph.root_id))
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    Ok(roots)
}

async fn blocked_child_parents(
    database: &impl ConnectionTrait,
    blocker_id: &str,
) -> Result<Vec<String>, GraphFactsError> {
    let dependent_ids = issue_blocker::Entity::find()
        .filter(issue_blocker::Column::ToIssueId.eq(blocker_id))
        .all(database)
        .await?
        .into_iter()
        .map(|edge| edge.from_issue_id)
        .collect::<Vec<_>>();
    if dependent_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(issue::Entity::find()
        .filter(issue::Column::Id.is_in(dependent_ids))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .all(database)
        .await?
        .into_iter()
        .filter_map(|dependent| dependent.parent_id)
        .collect())
}

async fn current_roots(
    database: &impl ConnectionTrait,
    candidate_ids: &[String],
) -> Result<HashMap<String, String>, GraphFactsError> {
    Ok(issue::Entity::find()
        .filter(issue::Column::Id.is_in(candidate_ids.to_vec()))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .all(database)
        .await?
        .into_iter()
        .map(|root| (root.id, root.project_id))
        .collect())
}
