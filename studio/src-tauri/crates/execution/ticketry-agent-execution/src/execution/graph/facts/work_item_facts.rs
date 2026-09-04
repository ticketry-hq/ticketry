use std::collections::{HashMap, HashSet};

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::execution::graph::{GraphFactsError, WorkItemFact};
use ticketry_entities::{issue, state};

pub(super) async fn states_by_id(
    database: &impl ConnectionTrait,
    rows: &[issue::Model],
) -> Result<HashMap<String, state::Model>, GraphFactsError> {
    let state_ids = rows
        .iter()
        .filter_map(|row| row.state_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if state_ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(state::Entity::find()
        .filter(state::Column::Id.is_in(state_ids))
        .all(database)
        .await?
        .into_iter()
        .map(|state| (state.id.clone(), state))
        .collect())
}

pub(super) fn work_item_fact(
    row: issue::Model,
    states: &HashMap<String, state::Model>,
) -> WorkItemFact {
    let workflow = row.state_id.as_ref().and_then(|id| states.get(id));
    WorkItemFact {
        id: public_id(&row.id),
        sequence_id: row.sequence_id,
        state_name: workflow.map(|state| state.name.clone()),
        state_group: workflow.map(|state| state.group.clone()),
        is_archived: row.is_archived,
    }
}

pub(super) fn missing_fact(id: &str) -> WorkItemFact {
    WorkItemFact {
        id: public_id(id),
        sequence_id: i32::MAX,
        state_name: None,
        state_group: None,
        is_archived: false,
    }
}

pub(super) fn public_id(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
