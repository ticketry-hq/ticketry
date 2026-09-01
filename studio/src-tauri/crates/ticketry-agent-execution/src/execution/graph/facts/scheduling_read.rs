use std::collections::{HashMap, HashSet};

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::execution::graph::{ChildSchedulingFacts, GraphAccess, GraphFactsError, WorkItemFact};
use ticketry_entities::{
    launch_claim,
    {issue, issue_blocker},
};

use super::{
    liveness::live_work_item_ids,
    root_scope::scoped_root,
    work_item_facts::{missing_fact, states_by_id, work_item_fact},
};

pub async fn scheduling_facts(
    database: &impl ConnectionTrait,
    root_id: &str,
    access: &GraphAccess,
    exclude_agent_run_id: Option<&str>,
) -> Result<Vec<ChildSchedulingFacts>, GraphFactsError> {
    let (_, children) = scoped_root(database, root_id, access).await?;
    let child_ids = children
        .iter()
        .map(|child| child.id.clone())
        .collect::<Vec<_>>();
    let edges = issue_blocker::Entity::find()
        .filter(issue_blocker::Column::FromIssueId.is_in(child_ids.clone()))
        .all(database)
        .await?;
    let blocker_ids = edges
        .iter()
        .map(|edge| edge.to_issue_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let blocker_rows = if blocker_ids.is_empty() {
        Vec::new()
    } else {
        issue::Entity::find()
            .filter(issue::Column::Id.is_in(blocker_ids))
            .all(database)
            .await?
    };
    let mut all_rows = children.clone();
    all_rows.extend(blocker_rows.iter().cloned());
    let states = states_by_id(database, &all_rows).await?;
    let blocker_facts = blocker_rows
        .into_iter()
        .map(|row| (row.id.clone(), work_item_fact(row, &states)))
        .collect::<HashMap<_, _>>();
    let mut blockers_by_child = blockers_by_child(edges, &blocker_facts);

    let claimed = launch_claim::Entity::find()
        .filter(launch_claim::Column::TaskId.is_in(child_ids.clone()))
        .all(database)
        .await?
        .into_iter()
        .map(|claim| claim.task_id)
        .collect::<HashSet<_>>();
    let live = live_work_item_ids(database, &child_ids, exclude_agent_run_id).await?;

    Ok(children
        .into_iter()
        .map(|child| {
            let child_id = child.id.clone();
            ChildSchedulingFacts {
                child: work_item_fact(child, &states),
                blockers: blockers_by_child.remove(&child_id).unwrap_or_default(),
                has_campaign_claim: claimed.contains(&child_id),
                has_live_work: live.contains(&child_id),
            }
        })
        .collect())
}

fn blockers_by_child(
    edges: Vec<issue_blocker::Model>,
    facts_by_id: &HashMap<String, WorkItemFact>,
) -> HashMap<String, Vec<WorkItemFact>> {
    let mut result = HashMap::<String, Vec<WorkItemFact>>::new();
    for edge in edges {
        let fact = facts_by_id
            .get(&edge.to_issue_id)
            .cloned()
            .unwrap_or_else(|| missing_fact(&edge.to_issue_id));
        result.entry(edge.from_issue_id).or_default().push(fact);
    }
    for facts in result.values_mut() {
        facts.sort_by(|left, right| left.id.cmp(&right.id));
        facts.dedup_by(|left, right| left.id == right.id);
    }
    result
}
