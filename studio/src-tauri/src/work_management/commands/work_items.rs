use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, ExprTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::fractional_rank;
use super::identifiers::{database_uuid, new_database_uuid};
use super::status_facts::{
    record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemFact, WorkItemIdentity,
};
use super::CommandError;
use crate::work_management::entities::{issue, issue_type, project, state};

pub use super::descriptions::{append_description, AppendDescription};
pub use super::review_findings::{create_review_finding, CreateReviewFinding};

#[derive(Debug, Clone)]
pub struct CreateWorkItem {
    pub project_id: String,
    pub name: String,
    pub issue_type_id: String,
    pub description: Option<String>,
    pub state_id: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateWorkItem {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub issue_type_id: Option<String>,
}

pub async fn create(
    database: &DatabaseConnection,
    input: CreateWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let project_id = database_uuid(&input.project_id, "project_id")?;
    let issue_type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let name = valid_name(&input.name)?;
    let selected_type = resolve_create_type(database, &project_id, &issue_type_id).await?;
    let item_type = selected_type.level.clone();
    let (state_id, parent_id, module_id) = match item_type.as_str() {
        "task" => {
            let state_id =
                resolve_birth_state(database, &project_id, &selected_type, input.state_id).await?;
            let (parent_id, module_id) =
                resolve_parent(database, &project_id, input.parent_id).await?;
            (state_id, parent_id, module_id)
        }
        "module" => {
            if input.state_id.is_some() {
                return Err(CommandError::field(
                    "state_id",
                    "A module does not have a workflow state.",
                ));
            }
            if input.parent_id.is_some() {
                return Err(CommandError::field(
                    "parent_id",
                    "A module must be a top-level work item.",
                ));
            }
            (None, None, None)
        }
        _ => unreachable!("resolve_create_type accepts only task and module levels"),
    };

    let transaction = database.begin().await?;
    // This is deliberately the transaction's first statement. SQLite obtains
    // its writer reservation here, and the single UPDATE atomically allocates
    // both counters before the insert can become visible.
    let counters = project::Entity::update_many()
        .col_expr(
            project::Column::SeqCounter,
            Expr::col(project::Column::SeqCounter).add(1),
        )
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision).add(1),
        )
        .col_expr(project::Column::UpdatedAt, Expr::current_timestamp())
        .filter(project::Column::Id.eq(&project_id))
        .exec_with_returning(&transaction)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    let sequence_id = counters.seq_counter;
    let state_revision = counters.state_revision;
    let tail = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&project_id))
        .filter(issue::Column::Rank.ne(""))
        .order_by_desc(issue::Column::Rank)
        .one(&transaction)
        .await?;
    let rank = fractional_rank::between(tail.as_ref().map(|row| row.rank.as_str()), None)
        .map_err(|_| CommandError::validation("An existing work-item rank is invalid."))?;
    let id = new_database_uuid();
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    issue::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(project_id.clone()),
        r#type: Set(item_type),
        issue_type_id: Set(issue_type_id),
        parent_id: Set(parent_id.clone()),
        module_id: Set(module_id.clone()),
        state_id: Set(state_id.clone()),
        state_revision: Set(state_revision),
        name: Set(name),
        sequence_id: Set(sequence_id),
        is_archived: Set(false),
        rank: Set(rank),
        description: Set(input.description.unwrap_or_default()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&transaction)
    .await?;
    record_work_item(
        facts,
        &transaction,
        WorkItemFact {
            project_id: &project_id,
            work_item_id: &id,
            change: WorkItemChange::Created,
            revision: state_revision,
            occurred_at: &occurred_at,
            parent_id: parent_id.as_deref(),
            module_id: module_id.as_deref(),
            state_id: state_id.as_deref(),
            is_archived: false,
        },
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub async fn update(
    database: &DatabaseConnection,
    input: UpdateWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    if input.name.is_none() && input.description.is_none() && input.issue_type_id.is_none() {
        return Err(CommandError::validation(
            "Supply at least one field to update.",
        ));
    }
    let id = database_uuid(&input.id, "id")?;
    let existing = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .filter(|row| row.r#type == "task")
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let name = input.name.as_deref().map(valid_name).transpose()?;
    let selected_type = match input.issue_type_id {
        Some(value) => {
            let type_id = database_uuid(&value, "issue_type_id")?;
            Some(resolve_type(database, &existing.project_id, &type_id, "task").await?)
        }
        None => None,
    };

    let changed = name.as_ref().is_some_and(|value| value != &existing.name)
        || input
            .description
            .as_ref()
            .is_some_and(|value| value != &existing.description)
        || selected_type
            .as_ref()
            .is_some_and(|value| value.id != existing.issue_type_id);
    if !changed {
        return Ok(id);
    }

    let transaction = database.begin().await?;
    let revision = next_revision(&transaction, &existing.project_id).await?;
    let identity = WorkItemIdentity::of(&existing);
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    let mut active: issue::ActiveModel = existing.into();
    if let Some(value) = name {
        active.name = Set(value);
    }
    if let Some(value) = input.description {
        active.description = Set(value);
    }
    if let Some(value) = selected_type {
        active.issue_type_id = Set(value.id);
    }
    active.state_revision = Set(revision);
    active.updated_at = Set(now.clone());
    active.update(&transaction).await?;
    record_work_item(
        facts,
        &transaction,
        identity.fact(WorkItemChange::Updated, revision, &occurred_at),
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub async fn archive(
    database: &DatabaseConnection,
    id: &str,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let id = database_uuid(id, "id")?;
    let existing = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    if existing.is_archived {
        return Ok(id);
    }
    let transaction = database.begin().await?;
    let revision = next_revision(&transaction, &existing.project_id).await?;
    let mut frontier = vec![id.clone()];
    let mut archived: Vec<String> = Vec::new();
    while !frontier.is_empty() {
        let children = issue::Entity::find()
            .filter(issue::Column::ParentId.is_in(frontier.clone()))
            .all(&transaction)
            .await?;
        frontier = children.into_iter().map(|row| row.id).collect();
        if !frontier.is_empty() {
            issue::Entity::update_many()
                .col_expr(
                    issue::Column::IsArchived,
                    sea_orm::sea_query::Expr::value(true),
                )
                .filter(issue::Column::Id.is_in(frontier.clone()))
                .exec(&transaction)
                .await?;
            archived.extend(frontier.iter().cloned());
        }
    }
    let mut identity = WorkItemIdentity::of(&existing);
    identity.is_archived = true;
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    let mut active: issue::ActiveModel = existing.into();
    active.is_archived = Set(true);
    active.state_revision = Set(revision);
    active.updated_at = Set(now.clone());
    active.update(&transaction).await?;
    // Archiving cascades to the whole subtree, so every descendant leaves the
    // collections it was displayed in. One fact per affected item keeps the
    // consumer's refresh proportional to what actually changed.
    for descendant in &archived {
        record_work_item(
            facts,
            &transaction,
            WorkItemFact {
                project_id: &identity.project_id,
                work_item_id: descendant,
                change: WorkItemChange::Archived,
                revision,
                occurred_at: &occurred_at,
                parent_id: None,
                module_id: None,
                state_id: None,
                is_archived: true,
            },
        )
        .await?;
    }
    record_work_item(
        facts,
        &transaction,
        identity.fact(WorkItemChange::Archived, revision, &occurred_at),
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub async fn delete(
    database: &DatabaseConnection,
    id: &str,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let id = database_uuid(id, "id")?;
    let existing = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    if issue::Entity::find()
        .filter(issue::Column::ParentId.eq(&id))
        .one(database)
        .await?
        .is_some()
    {
        return Err(CommandError::Conflict(
            "Issue has children; empty or re-parent them first.".to_owned(),
        ));
    }
    let transaction = database.begin().await?;
    let revision = next_revision(&transaction, &existing.project_id).await?;
    let identity = WorkItemIdentity::of(&existing);
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    issue::Entity::delete_by_id(id).exec(&transaction).await?;
    record_work_item(
        facts,
        &transaction,
        identity.fact(WorkItemChange::Deleted, revision, &occurred_at),
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(())
}

pub(super) async fn next_revision<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<i64, CommandError> {
    let row = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision).add(1),
        )
        .col_expr(project::Column::UpdatedAt, Expr::current_timestamp())
        .filter(project::Column::Id.eq(project_id))
        .exec_with_returning(database)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    Ok(row.state_revision)
}

async fn resolve_type(
    database: &DatabaseConnection,
    project_id: &str,
    id: &str,
    level: &str,
) -> Result<issue_type::Model, CommandError> {
    let selected = issue_type::Entity::find_by_id(id)
        .filter(issue_type::Column::ProjectId.eq(project_id))
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Issue type not found.".to_owned()))?;
    if selected.level != level {
        return Err(CommandError::validation(format!(
            "Issue type '{}' is level '{}', not '{}'.",
            selected.name, selected.level, level
        )));
    }
    Ok(selected)
}

async fn resolve_create_type(
    database: &DatabaseConnection,
    project_id: &str,
    id: &str,
) -> Result<issue_type::Model, CommandError> {
    let selected = issue_type::Entity::find_by_id(id)
        .filter(issue_type::Column::ProjectId.eq(project_id))
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Issue type not found.".to_owned()))?;
    if !matches!(selected.level.as_str(), "task" | "module") {
        return Err(CommandError::validation(format!(
            "Issue type '{}' has unsupported level '{}'.",
            selected.name, selected.level
        )));
    }
    Ok(selected)
}

async fn resolve_birth_state(
    database: &DatabaseConnection,
    project_id: &str,
    selected_type: &issue_type::Model,
    requested: Option<String>,
) -> Result<Option<String>, CommandError> {
    let requested = requested
        .map(|value| database_uuid(&value, "state_id"))
        .transpose()?;
    if let Some(start_id) = &selected_type.start_state_id {
        let start = state::Entity::find_by_id(start_id)
            .filter(state::Column::ProjectId.eq(project_id))
            .one(database)
            .await?
            .ok_or_else(|| CommandError::IllegalBirth {
                message: "The published workflow start state no longer exists.".to_owned(),
                to_state: None,
            })?;
        if requested.as_ref().is_some_and(|value| value != &start.id) {
            let to_state = match &requested {
                Some(id) => state::Entity::find_by_id(id)
                    .one(database)
                    .await?
                    .map(|row| row.name),
                None => None,
            };
            return Err(CommandError::IllegalBirth {
                message: format!(
                    "A {} is born in {:?}; it cannot be created in another state.",
                    selected_type.name, start.name
                ),
                to_state,
            });
        }
        return Ok(Some(start.id));
    }
    if requested.is_some() {
        return Ok(requested);
    }
    Ok(state::Entity::find()
        .filter(state::Column::ProjectId.eq(project_id))
        .filter(state::Column::Group.eq("backlog"))
        .order_by_asc(state::Column::SortOrder)
        .order_by_asc(state::Column::CreatedAt)
        .one(database)
        .await?
        .map(|row| row.id))
}

async fn resolve_parent(
    database: &DatabaseConnection,
    project_id: &str,
    parent: Option<String>,
) -> Result<(Option<String>, Option<String>), CommandError> {
    let Some(parent) = parent else {
        return Ok((None, None));
    };
    let id = database_uuid(&parent, "parent_id")?;
    let parent = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Parent work item not found.".to_owned()))?;
    if parent.project_id != project_id {
        return Err(CommandError::validation(
            "Parent work item belongs to another project.",
        ));
    }
    let module_id = if parent.r#type == "module" {
        Some(parent.id.clone())
    } else if let Some(module_id) = parent.module_id {
        let module = issue::Entity::find_by_id(&module_id)
            .one(database)
            .await?
            .ok_or_else(|| CommandError::validation("Parent has a stale module ancestor."))?;
        if module.r#type != "module" || module.project_id != parent.project_id {
            return Err(CommandError::validation(
                "Parent has an invalid module ancestor.",
            ));
        }
        Some(module.id)
    } else {
        None
    };
    Ok((Some(parent.id), module_id))
}

pub(super) fn valid_name(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CommandError::field("name", "This field may not be blank."));
    }
    if value.chars().count() > 512 {
        return Err(CommandError::field(
            "name",
            "Ensure this field has no more than 512 characters.",
        ));
    }
    Ok(value.to_owned())
}
