use std::collections::{HashMap, HashSet};

use sea_orm::{
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, JoinType, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait,
};

use crate::entities::work_management::{issue, issue_blocker, module_presentation, project};
use super::read_types as output;

mod catalog;
mod workflow_configuration;

pub use catalog::{agent_models, providers, reasoning_levels};
pub use workflow_configuration::{issue_type, issue_types, launch_bindings, states, transitions};

#[derive(Clone)]
pub struct ReadDatabase(pub DatabaseConnection);

fn uuid(value: &str) -> String {
    let compact: String = value
        .chars()
        .filter(|character| *character != '-')
        .collect();
    if compact.len() != 32
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return value.to_owned();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..12],
        &compact[12..16],
        &compact[16..20],
        &compact[20..32]
    )
}

fn database_uuid(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect::<String>()
        .to_lowercase()
}

fn timestamp(value: sea_orm::prelude::DateTime) -> String {
    format!("{}Z", value.format("%Y-%m-%dT%H:%M:%S%.f"))
}

fn project_output(row: project::Model) -> output::Project {
    output::Project {
        id: uuid(&row.id),
        name: row.name,
        slug: row.slug,
        description: row.description,
        onboarding_required: row.onboarding_required,
    }
}

/// The installation's own project, resolved the way the whole app resolves it.
///
/// Onboarding, the local settings profile, and MCP discovery all mean the same
/// project by "the installation project": the one carrying a recognized slug,
/// or failing that the oldest. Reading it through one query keeps them agreed.
pub async fn installation_project(
    database: &DatabaseConnection,
) -> Result<Option<output::Project>, DbErr> {
    let Some(id) = super::project_onboarding_migration::installation_project_id(database).await?
    else {
        return Ok(None);
    };
    Ok(project::Entity::find_by_id(id)
        .one(database)
        .await?
        .map(project_output))
}

pub async fn projects(database: &DatabaseConnection) -> Result<Vec<output::Project>, DbErr> {
    Ok(project::Entity::find()
        .order_by_asc(project::Column::CreatedAt)
        .order_by_asc(project::Column::Id)
        .all(database)
        .await?
        .into_iter()
        .map(project_output)
        .collect())
}

async fn project_slugs(database: &DatabaseConnection) -> Result<HashMap<String, String>, DbErr> {
    Ok(project::Entity::find()
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.id, row.slug))
        .collect())
}

pub async fn modules(
    database: &DatabaseConnection,
    project_id: &str,
    include_archived: bool,
) -> Result<Vec<output::Module>, DbErr> {
    let project_id = database_uuid(project_id);
    let Some(project) = project::Entity::find_by_id(&project_id)
        .one(database)
        .await?
    else {
        return Ok(Vec::new());
    };
    let mut query = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&project_id))
        .filter(issue::Column::Type.eq("module"));
    if !include_archived {
        query = query.filter(issue::Column::IsArchived.eq(false));
    }
    // Source: backend/worktracker/module_order.py. SQLite's BINARY collation
    // gives fractional base-62 ranks their canonical byte order.
    let has_manual_order = module_presentation::Entity::find()
        .join(
            JoinType::InnerJoin,
            module_presentation::Relation::Module.def(),
        )
        .filter(issue::Column::ProjectId.eq(&project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(module_presentation::Column::Rank.ne(""))
        .one(database)
        .await?
        .is_some();
    query = if has_manual_order {
        query
            .join(JoinType::LeftJoin, issue::Relation::Presentation.def())
            .order_by_asc(module_presentation::Column::Rank)
            .order_by_asc(issue::Column::Id)
    } else {
        query
            .order_by_desc(issue::Column::SequenceId)
            .order_by_asc(issue::Column::Id)
    };
    Ok(query
        .all(database)
        .await?
        .into_iter()
        .map(|row| output::Module {
            id: uuid(&row.id),
            name: row.name,
            project_id: uuid(&row.project_id),
            sequence_id: row.sequence_id,
            key: format!("{}-{}", project.slug, row.sequence_id),
            is_archived: row.is_archived,
            issue_type: uuid(&row.issue_type_id),
        })
        .collect())
}

pub async fn work_items(
    database: &DatabaseConnection,
    project_id: Option<&str>,
    module_id: Option<&str>,
    state_id: Option<&str>,
) -> Result<Vec<output::WorkItem>, DbErr> {
    let mut query = issue::Entity::find().filter(issue::Column::Type.eq("task"));
    if let Some(value) = project_id {
        query = query.filter(issue::Column::ProjectId.eq(database_uuid(value)));
    }
    if let Some(value) = module_id {
        query = query.filter(issue::Column::ModuleId.eq(database_uuid(value)));
    }
    if let Some(value) = state_id {
        query = query.filter(issue::Column::StateId.eq(database_uuid(value)));
    }
    let rows = query
        .order_by_asc(issue::Column::Rank)
        .order_by_asc(issue::Column::SequenceId)
        .order_by_asc(issue::Column::Id)
        .all(database)
        .await?;
    project_work_items(database, rows).await
}

pub async fn work_items_by_ids(
    database: &DatabaseConnection,
    ids: &[String],
) -> Result<Vec<output::WorkItem>, DbErr> {
    let ordered: Vec<String> = ids.iter().map(|id| database_uuid(id)).collect();
    let wanted: HashSet<&str> = ordered.iter().map(String::as_str).collect();
    let rows = issue::Entity::find()
        .filter(issue::Column::Type.eq("task"))
        .all(database)
        .await?;
    let by_id: HashMap<String, issue::Model> = rows
        .into_iter()
        .filter(|row| wanted.contains(row.id.as_str()))
        .map(|row| (row.id.clone(), row))
        .collect();
    let rows = ordered
        .iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .filter_map(|id| by_id.get(id).cloned())
        .collect::<Vec<_>>();
    // Restore caller order after de-duplication (services/work_items.py).
    let rows_by_id: HashMap<_, _> = rows.into_iter().map(|row| (row.id.clone(), row)).collect();
    let mut seen = HashSet::new();
    let ordered_rows = ordered
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .filter_map(|id| rows_by_id.get(&id).cloned())
        .collect();
    project_work_items(database, ordered_rows).await
}

pub async fn work_item(
    database: &DatabaseConnection,
    id_or_key: &str,
) -> Result<Option<output::WorkItem>, DbErr> {
    let row = if let Some((slug, sequence)) = id_or_key.rsplit_once('-') {
        if let Ok(sequence_id) = sequence.parse::<i32>() {
            let project = project::Entity::find()
                .filter(project::Column::Slug.eq(slug.to_uppercase()))
                .one(database)
                .await?;
            match project {
                Some(project) => {
                    issue::Entity::find()
                        .filter(issue::Column::ProjectId.eq(project.id))
                        .filter(issue::Column::SequenceId.eq(sequence_id))
                        .filter(issue::Column::Type.eq("task"))
                        .one(database)
                        .await?
                }
                None => None,
            }
        } else {
            issue::Entity::find_by_id(database_uuid(id_or_key))
                .one(database)
                .await?
        }
    } else {
        issue::Entity::find_by_id(database_uuid(id_or_key))
            .one(database)
            .await?
    };
    let Some(row) = row.filter(|row| row.r#type == "task") else {
        return Ok(None);
    };
    Ok(project_work_items(database, vec![row]).await?.pop())
}

async fn project_work_items(
    database: &DatabaseConnection,
    rows: Vec<issue::Model>,
) -> Result<Vec<output::WorkItem>, DbErr> {
    let slugs = project_slugs(database).await?;
    let all_issues = issue::Entity::find().all(database).await?;
    let blockers = issue_blocker::Entity::find().all(database).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let child_count = all_issues
                .iter()
                .filter(|child| child.parent_id.as_deref() == Some(&row.id) && !child.is_archived)
                .count() as i32;
            let blocked_by_ids = blockers
                .iter()
                .filter(|edge| edge.from_issue_id == row.id)
                .map(|edge| uuid(&edge.to_issue_id))
                .collect();
            let blocks_ids = blockers
                .iter()
                .filter(|edge| edge.to_issue_id == row.id)
                .map(|edge| uuid(&edge.from_issue_id))
                .collect();
            output::WorkItem {
                id: uuid(&row.id),
                name: row.name,
                project_id: uuid(&row.project_id),
                sequence_id: row.sequence_id,
                state: row.state_id.as_deref().map(uuid),
                state_revision: row.state_revision,
                description: row.description,
                parent_id: row.parent_id.as_deref().map(uuid),
                module_id: row.module_id.as_deref().map(uuid),
                sub_issues_count: child_count,
                key: format!(
                    "{}-{}",
                    slugs.get(&row.project_id).map(String::as_str).unwrap_or(""),
                    row.sequence_id
                ),
                is_archived: row.is_archived,
                created_at: timestamp(row.created_at),
                updated_at: timestamp(row.updated_at),
                rank: row.rank,
                issue_type: uuid(&row.issue_type_id),
                blocked_by_ids: output::StringList(blocked_by_ids),
                blocks_ids: output::StringList(blocks_ids),
            }
        })
        .collect())
}
