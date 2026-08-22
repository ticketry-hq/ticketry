use std::collections::{HashMap, HashSet};

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

use crate::entities::work_management::{issue, issue_blocker};
use crate::execution_graph::{DependencyGraph, DependencyGraphNode, GraphAccess, GraphFactsError};

use super::{
    root_scope::scoped_root,
    work_item_facts::{public_id, states_by_id},
};

pub async fn dependency_graph(
    database: &impl ConnectionTrait,
    root_id: &str,
    access: &GraphAccess,
) -> Result<DependencyGraph, GraphFactsError> {
    let (root, first_children) = scoped_root(database, root_id, access).await?;
    let mut rows = vec![root.clone()];
    let mut frontier = first_children;
    while !frontier.is_empty() {
        rows.extend(frontier.iter().cloned());
        let parent_ids = frontier.into_iter().map(|row| row.id).collect::<Vec<_>>();
        frontier = issue::Entity::find()
            .filter(issue::Column::ParentId.is_in(parent_ids))
            .filter(issue::Column::Type.eq("task"))
            .filter(issue::Column::IsArchived.eq(false))
            .order_by_asc(issue::Column::SequenceId)
            .order_by_asc(issue::Column::Id)
            .all(database)
            .await?;
    }

    let node_ids = rows.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let node_set = node_ids.iter().cloned().collect::<HashSet<_>>();
    let states = states_by_id(database, &rows).await?;
    let edges = issue_blocker::Entity::find()
        .filter(issue_blocker::Column::FromIssueId.is_in(node_ids))
        .all(database)
        .await?;
    let mut blockers = HashMap::<String, Vec<String>>::new();
    for edge in edges {
        if node_set.contains(&edge.to_issue_id) {
            blockers
                .entry(edge.from_issue_id)
                .or_default()
                .push(public_id(&edge.to_issue_id));
        }
    }
    for ids in blockers.values_mut() {
        ids.sort();
        ids.dedup();
    }

    Ok(DependencyGraph {
        root_id: public_id(&root.id),
        nodes: rows
            .into_iter()
            .map(|row| DependencyGraphNode {
                state: row
                    .state_id
                    .as_ref()
                    .and_then(|id| states.get(id))
                    .map(|state| state.name.clone())
                    .unwrap_or_default(),
                parent_id: row.parent_id.as_deref().map(public_id),
                blocked_by: blockers.remove(&row.id).unwrap_or_default(),
                id: public_id(&row.id),
            })
            .collect(),
    })
}
