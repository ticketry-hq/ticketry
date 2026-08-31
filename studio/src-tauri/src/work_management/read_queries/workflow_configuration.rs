use std::collections::HashMap;
use ticketry_entities::graphql_scalars::StringList;

use sea_orm::{ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder};

use super::{database_uuid, timestamp, uuid};
use crate::work_management::read_types as output;
use ticketry_entities::work_management::{
    issue_type, issue_type_transition, launch_binding, state,
};

pub async fn states(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<output::State>, DbErr> {
    Ok(state::Entity::find()
        .filter(state::Column::ProjectId.eq(database_uuid(project_id)))
        .order_by_asc(state::Column::SortOrder)
        .order_by_asc(state::Column::CreatedAt)
        .all(database)
        .await?
        .into_iter()
        .map(|row| output::State {
            id: uuid(&row.id),
            project: uuid(&row.project_id),
            name: row.name,
            group: row.group,
            color: row.color,
            sort_order: row.sort_order,
            is_protected: row.is_protected,
            created_at: timestamp(row.created_at),
            updated_at: timestamp(row.updated_at),
        })
        .collect())
}

fn issue_type_output(row: issue_type::Model) -> output::IssueType {
    output::IssueType {
        id: uuid(&row.id),
        project: uuid(&row.project_id),
        name: row.name,
        level: row.level,
        color: row.color,
        sort_order: row.sort_order,
        start_state: row.start_state_id.as_deref().map(uuid),
        workflow_revision: row.workflow_revision,
        is_pathfind: row.is_pathfind,
        created_at: timestamp(row.created_at),
        updated_at: timestamp(row.updated_at),
    }
}

pub async fn issue_types(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<output::IssueType>, DbErr> {
    Ok(issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(database_uuid(project_id)))
        .order_by_asc(issue_type::Column::SortOrder)
        .order_by_asc(issue_type::Column::CreatedAt)
        .all(database)
        .await?
        .into_iter()
        .map(issue_type_output)
        .collect())
}

pub async fn issue_type(
    database: &DatabaseConnection,
    id: &str,
) -> Result<Option<output::IssueType>, DbErr> {
    Ok(issue_type::Entity::find_by_id(database_uuid(id))
        .one(database)
        .await?
        .map(issue_type_output))
}

pub async fn transitions(
    database: &DatabaseConnection,
    type_id: &str,
) -> Result<Vec<output::IssueTypeTransition>, DbErr> {
    let state_orders: HashMap<String, i32> = state::Entity::find()
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.id, row.sort_order))
        .collect();
    let mut rows = issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(database_uuid(type_id)))
        .all(database)
        .await?;
    // Source: services/scoped_workflows.py:list_transitions.
    rows.sort_by_key(|row| {
        (
            state_orders
                .get(&row.from_state_id)
                .copied()
                .unwrap_or(i32::MAX),
            state_orders
                .get(&row.to_state_id)
                .copied()
                .unwrap_or(i32::MAX),
            row.id,
        )
    });
    Ok(rows
        .into_iter()
        .map(|row| output::IssueTypeTransition {
            id: row.id,
            issue_type: uuid(&row.issue_type_id),
            from_state: uuid(&row.from_state_id),
            to_state: uuid(&row.to_state_id),
            agent_allowed: row.agent_allowed,
        })
        .collect())
}

pub async fn launch_bindings(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<output::LaunchBinding>, DbErr> {
    let types: HashMap<String, issue_type::Model> = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(database_uuid(project_id)))
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect();
    let states: HashMap<String, i32> = state::Entity::find()
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.id, row.sort_order))
        .collect();
    let mut rows = launch_binding::Entity::find()
        .all(database)
        .await?
        .into_iter()
        .filter(|row| types.contains_key(&row.issue_type_id))
        .collect::<Vec<_>>();
    // Source: services/launch_bindings.py:list_launch_bindings.
    rows.sort_by_key(|row| {
        (
            types
                .get(&row.issue_type_id)
                .map(|value| value.sort_order)
                .unwrap_or(i32::MAX),
            states.get(&row.state_id).copied().unwrap_or(i32::MAX),
            row.id,
        )
    });
    Ok(rows
        .into_iter()
        .map(|row| output::LaunchBinding {
            id: row.id,
            issue_type: uuid(&row.issue_type_id),
            state: uuid(&row.state_id),
            prompt: row.prompt,
            required_skills: StringList(
                row.required_skills
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect(),
            ),
            model: row.model_id.as_deref().map(uuid),
            reasoning: row.reasoning_id.as_deref().map(uuid),
            auto_start: row.auto_start,
            subtree_run_enabled: row.subtree_run_enabled,
            created_at: timestamp(row.created_at),
            updated_at: timestamp(row.updated_at),
        })
        .collect())
}
