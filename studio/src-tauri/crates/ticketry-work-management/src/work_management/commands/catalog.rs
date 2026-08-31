use std::collections::{HashMap, HashSet};

use super::default_project_catalog;
use super::identifiers::{database_uuid, new_database_uuid};
use super::status_facts::{
    record_workflow_state, stamp, WorkFactRecorder, WorkflowStateChange, WorkflowStateFact,
};
use super::CommandError;
use rand::seq::SliceRandom;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter, Set, TransactionTrait,
    TryIntoModel,
};
use ticketry_entities::work_management::{issue, issue_type, project, state};

const GROUPS: &[&str] = &["backlog", "unstarted", "started", "completed", "cancelled"];
const PALETTE: &[&str] = &[
    "#8A3FFC", "#33B1FF", "#007D79", "#FF7EB6", "#FA4D56", "#FFF1F1", "#6FDC8C", "#4589FF",
    "#D12771", "#D2A106", "#08BDBA", "#BAE6FF", "#BA4E00", "#D4BBFF",
];

#[derive(Debug, Clone)]
pub struct CreateProject {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateState {
    pub project_id: String,
    pub name: String,
    pub group: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateProject {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateIssueType {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    /// The workflow's start state. Requires `workflow_revision`.
    pub start_state_id: Option<String>,
    pub workflow_revision: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct UpdateState {
    pub id: String,
    pub name: Option<String>,
    pub group: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

pub async fn create_project(
    database: &DatabaseConnection,
    input: CreateProject,
) -> Result<String, CommandError> {
    let name = valid_text(&input.name, "name", 255)?;
    let slug = input.slug.to_ascii_uppercase();
    if slug.len() != 3 || !slug.bytes().all(|value| value.is_ascii_uppercase()) {
        return Err(CommandError::field(
            "slug",
            "Project key must be exactly three letters, using only A-Z.",
        ));
    }
    if project::Entity::find()
        .filter(project::Column::Slug.eq(&slug))
        .one(database)
        .await?
        .is_some()
    {
        return Err(CommandError::Conflict(format!(
            "Project slug '{slug}' already exists."
        )));
    }

    let transaction = database.begin().await?;
    let id = new_database_uuid();
    let now = super::timestamp::now();
    project::ActiveModel {
        id: Set(id.clone()),
        name: Set(name),
        slug: Set(slug),
        description: Set(input.description.unwrap_or_default()),
        seq_counter: Set(0),
        state_revision: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        // A project created from inside a running Studio has no first-run
        // welcome to show. Onboarding is pending only for an installation that
        // has no project at all, or for one migrated with the flag still set.
        onboarding_required: Set(false),
    }
    .insert(&transaction)
    .await?;

    default_project_catalog::seed(&transaction, &id).await?;
    transaction.commit().await?;
    Ok(id)
}

/// Clear the named project's pending onboarding.
///
/// The caller names the project, so an acknowledgement is bound to the identity
/// it was shown for rather than to whichever project happens to sort first.
pub async fn acknowledge_onboarding(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<String, CommandError> {
    let active = prepare_acknowledge_onboarding(database, project_id).await?;
    Ok(active.update(database).await?.id)
}

/// Prepare the one Project row changed by onboarding acknowledgement.
pub async fn prepare_acknowledge_onboarding(
    database: &impl ConnectionTrait,
    project_id: &str,
) -> Result<project::ActiveModel, CommandError> {
    let id = database_uuid(project_id, "project_id")?;
    let row = project::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    let mut active: project::ActiveModel = row.into();
    active.onboarding_required = Set(false);
    active.updated_at = Set(super::timestamp::now());
    Ok(active)
}

pub async fn update_project(
    database: &DatabaseConnection,
    input: UpdateProject,
) -> Result<String, CommandError> {
    let active = prepare_update_project(database, input).await?;
    Ok(active.update(database).await?.id)
}

/// Prepare an identity-bound Project patch without persisting it.
pub async fn prepare_update_project(
    database: &impl ConnectionTrait,
    input: UpdateProject,
) -> Result<project::ActiveModel, CommandError> {
    let id = database_uuid(&input.id, "project_id")?;
    let row = project::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    let mut active: project::ActiveModel = row.into();
    if let Some(name) = input.name {
        active.name = Set(valid_text(&name, "name", 255)?);
    }
    if let Some(description) = input.description {
        active.description = Set(description);
    }
    active.updated_at = Set(super::timestamp::now());
    Ok(active)
}

pub async fn delete_project(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<(), CommandError> {
    let id = database_uuid(project_id, "project_id")?;
    let transaction = database.begin().await?;
    if project::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .is_none()
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    // Match Django's aggregate teardown: IssueType is protected by selected
    // WorkItems, so delete the project's tree before cascading its catalogue.
    issue::Entity::delete_many()
        .filter(issue::Column::ProjectId.eq(&id))
        .exec(&transaction)
        .await?;
    project::Entity::delete_by_id(id).exec(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn create_state(
    database: &DatabaseConnection,
    input: CreateState,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let transaction = database.begin().await?;
    let active = prepare_state_create(&transaction, input, facts).await?;
    let id = active.id.as_ref().to_owned();
    active.insert(&transaction).await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

/// Prepare one project-locked State insert inside the caller's transaction.
pub async fn prepare_state_create(
    transaction: &DatabaseTransaction,
    input: CreateState,
    facts: Option<&WorkFactRecorder>,
) -> Result<state::ActiveModel, CommandError> {
    let project_id = database_uuid(&input.project_id, "project_id")?;
    let name = valid_text(&input.name, "name", 255)?;
    if !GROUPS.contains(&input.group.as_str()) {
        return Err(CommandError::validation(format!(
            "Unknown group '{}'.",
            input.group
        )));
    }
    // Match Django's select_for_update boundary. The no-op UPDATE is the
    // portable SQLite writer reservation before color and order are observed.
    if project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(transaction)
        .await?
        .rows_affected
        == 0
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let existing = state::Entity::find()
        .filter(state::Column::ProjectId.eq(&project_id))
        .all(transaction)
        .await?;
    let max_order = existing.iter().map(|row| row.sort_order).max();
    let color = match input.color.filter(|value| !value.trim().is_empty()) {
        Some(color) => color,
        None => {
            let used = existing
                .iter()
                .map(|row| row.color.to_ascii_lowercase())
                .collect::<HashSet<_>>();
            PALETTE
                .iter()
                .filter(|color| !used.contains(&color.to_ascii_lowercase()))
                .copied()
                .collect::<Vec<_>>()
                .choose(&mut rand::thread_rng())
                .copied()
                .ok_or_else(|| {
                    CommandError::Conflict(
                        "No automatic workflow-state colors remain for this project.".to_owned(),
                    )
                })?
                .to_owned()
        }
    };
    let id = new_database_uuid();
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    let sort_order = max_order.map_or(0, |value| value + 1);
    let active = state::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(project_id.clone()),
        name: Set(name.clone()),
        group: Set(input.group.clone()),
        color: Set(color.clone()),
        sort_order: Set(sort_order),
        is_protected: Set(false),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };
    record_workflow_state(
        facts,
        transaction,
        WorkflowStateFact {
            project_id: &project_id,
            state_id: &id,
            change: WorkflowStateChange::Created,
            name: &name,
            group: &input.group,
            color: &color,
            sort_order,
            occurred_at: &occurred_at,
        },
    )
    .await?;
    Ok(active)
}

pub async fn update_issue_type(
    database: &DatabaseConnection,
    input: UpdateIssueType,
) -> Result<String, CommandError> {
    let transaction = database.begin().await?;
    let active = prepare_issue_type_update(&transaction, input).await?;
    let id = active.id.as_ref().to_owned();
    active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(id)
}

/// Prepare one restricted Issue Type update inside the caller's transaction.
///
/// Seaolim uses this path to own the row save and commit. Native callers use
/// the wrapper above and persist the returned model in the same transaction.
pub async fn prepare_issue_type_update(
    transaction: &sea_orm::DatabaseTransaction,
    input: UpdateIssueType,
) -> Result<issue_type::ActiveModel, CommandError> {
    let id = database_uuid(&input.id, "issue_type_id")?;
    // The start-state member claims the workflow revision, which rewrites the
    // row the rest of this patch is derived from, so it is applied first.
    if let Some(start_state_id) = input.start_state_id.as_deref() {
        let workflow_revision = input.workflow_revision.ok_or_else(|| {
            CommandError::field(
                "workflow_revision",
                "Supply the workflow revision to change the start state.",
            )
        })?;
        super::workflow::apply_start_state(&transaction, &id, start_state_id, workflow_revision)
            .await?;
    }
    let row = issue_type::Entity::find_by_id(&id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Issue type not found.".to_owned()))?;
    if let Some(name) = input.name.as_deref() {
        let name = valid_text(name, "name", 255)?;
        if issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(&row.project_id))
            .filter(issue_type::Column::Name.eq(&name))
            .filter(issue_type::Column::Id.ne(&id))
            .one(transaction)
            .await?
            .is_some()
        {
            return Err(CommandError::Conflict(format!(
                "Issue type '{name}' already exists."
            )));
        }
    }
    let mut active: issue_type::ActiveModel = row.into();
    if let Some(name) = input.name {
        active.name = Set(valid_text(&name, "name", 255)?);
    }
    if let Some(color) = input.color {
        active.color = Set(color);
    }
    if let Some(sort_order) = input.sort_order {
        active.sort_order = Set(sort_order);
    }
    active.updated_at = Set(super::timestamp::now());
    Ok(active)
}

pub async fn delete_issue_type(
    database: &DatabaseConnection,
    issue_type_id: &str,
    reassign_to: Option<&str>,
) -> Result<(), CommandError> {
    let id = database_uuid(issue_type_id, "issue_type_id")?;
    let transaction = database.begin().await?;
    let row = issue_type::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Issue type not found.".to_owned()))?;
    let in_use = ticketry_entities::work_management::issue::Entity::find()
        .filter(ticketry_entities::work_management::issue::Column::IssueTypeId.eq(&id))
        .count(&transaction)
        .await?;
    if in_use != 0 && reassign_to.is_none() {
        return Err(CommandError::Conflict(format!(
            "{in_use} issue(s) use this type; pass reassign_to to repoint them."
        )));
    }
    if let Some(target_id) = reassign_to {
        let target_id = database_uuid(target_id, "reassign_to")?;
        let target = issue_type::Entity::find_by_id(&target_id)
            .one(&transaction)
            .await?
            .ok_or_else(|| CommandError::NotFound("reassign_to type not found.".to_owned()))?;
        if target.project_id != row.project_id || target.level != row.level {
            return Err(CommandError::validation(
                "reassign_to must be the same level.",
            ));
        }
        issue::Entity::update_many()
            .col_expr(issue::Column::IssueTypeId, Expr::value(target_id))
            .filter(issue::Column::IssueTypeId.eq(&id))
            .exec(&transaction)
            .await?;
    }
    issue_type::Entity::delete_by_id(id)
        .exec(&transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}

pub async fn update_state(
    database: &DatabaseConnection,
    input: UpdateState,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let transaction = database.begin().await?;
    let active = prepare_state_update(&transaction, input, facts).await?;
    let id = active.id.as_ref().to_owned();
    active.update(&transaction).await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

/// Prepare one identity-bound State patch inside the caller's transaction.
pub async fn prepare_state_update(
    transaction: &DatabaseTransaction,
    input: UpdateState,
    facts: Option<&WorkFactRecorder>,
) -> Result<state::ActiveModel, CommandError> {
    let id = database_uuid(&input.id, "state_id")?;
    let row = state::Entity::find_by_id(&id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("State not found.".to_owned()))?;
    if let Some(group) = input.group.as_deref() {
        if !GROUPS.contains(&group) {
            return Err(CommandError::validation(format!(
                "Unknown group '{group}'."
            )));
        }
    }
    let project_id = row.project_id.clone();
    let mut active: state::ActiveModel = row.into();
    if let Some(name) = input.name {
        active.name = Set(valid_text(&name, "name", 255)?);
    }
    if let Some(group) = input.group {
        active.group = Set(group);
    }
    if let Some(color) = input.color {
        active.color = Set(color);
    }
    if let Some(sort_order) = input.sort_order {
        active.sort_order = Set(sort_order);
    }
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    active.updated_at = Set(now.clone());
    // The fact and the proposed row share one transaction. A later save failure
    // rolls both back, while the payload still carries the authoritative values.
    let proposed = active.clone().try_into_model()?;
    record_workflow_state(
        facts,
        transaction,
        WorkflowStateFact {
            project_id: &project_id,
            state_id: &proposed.id,
            change: WorkflowStateChange::Updated,
            name: &proposed.name,
            group: &proposed.group,
            color: &proposed.color,
            sort_order: proposed.sort_order,
            occurred_at: &occurred_at,
        },
    )
    .await?;
    Ok(active)
}

pub async fn reorder_issue_types(
    database: &DatabaseConnection,
    project_id: &str,
    ordered_ids: Vec<String>,
) -> Result<(), CommandError> {
    let transaction = database.begin().await?;
    for (_, active) in prepare_issue_type_reorder(&transaction, project_id, ordered_ids).await? {
        active.update(&transaction).await?;
    }
    transaction.commit().await?;
    Ok(())
}

/// Prepare the complete project-owned Issue Type ordering.
///
/// The returned row pairs follow the caller's requested order. Seaolim keeps
/// that order through persistence and in the GraphQL result list.
pub async fn prepare_issue_type_reorder(
    transaction: &sea_orm::DatabaseTransaction,
    project_id: &str,
    ordered_ids: Vec<String>,
) -> Result<Vec<(issue_type::Model, issue_type::ActiveModel)>, CommandError> {
    let project_id = database_uuid(project_id, "project_id")?;
    let ids = ordered_ids
        .iter()
        .map(|id| database_uuid(id, "ordered_ids"))
        .collect::<Result<Vec<_>, _>>()?;
    if project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(transaction)
        .await?
        .rows_affected
        == 0
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let existing = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(&project_id))
        .all(transaction)
        .await?;
    let existing_ids = existing
        .iter()
        .map(|row| row.id.as_str())
        .collect::<HashSet<_>>();
    if existing.len() != ids.len()
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        || !ids.iter().all(|id| existing_ids.contains(id.as_str()))
    {
        return Err(CommandError::validation(
            "ordered_ids must be exactly this project's rows.",
        ));
    }
    let mut by_id = existing
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect::<HashMap<_, _>>();
    Ok(ids
        .into_iter()
        .enumerate()
        .map(|(sort_order, id)| {
            let row = by_id
                .remove(&id)
                .expect("validated Issue Type reorder identity");
            let mut active: issue_type::ActiveModel = row.clone().into();
            active.sort_order = Set(sort_order as i32);
            (row, active)
        })
        .collect())
}

pub async fn reorder_states(
    database: &DatabaseConnection,
    project_id: &str,
    ordered_ids: Vec<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let transaction = database.begin().await?;
    for (_, active) in prepare_state_reorder(&transaction, project_id, ordered_ids, facts).await? {
        active.update(&transaction).await?;
    }
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(())
}

/// Prepare the complete project-owned State ordering.
pub async fn prepare_state_reorder(
    transaction: &DatabaseTransaction,
    project_id: &str,
    ordered_ids: Vec<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<Vec<(state::Model, state::ActiveModel)>, CommandError> {
    let project_id = database_uuid(project_id, "project_id")?;
    let ids = ordered_ids
        .iter()
        .map(|id| database_uuid(id, "ordered_ids"))
        .collect::<Result<Vec<_>, _>>()?;
    if project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(transaction)
        .await?
        .rows_affected
        == 0
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let existing = state::Entity::find()
        .filter(state::Column::ProjectId.eq(&project_id))
        .all(transaction)
        .await?;
    let stored_ids = existing
        .iter()
        .map(|row| row.id.clone())
        .collect::<HashSet<_>>();
    if stored_ids.len() != ids.len()
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        || !ids.iter().all(|id| stored_ids.contains(id))
    {
        return Err(CommandError::validation(
            "ordered_ids must be exactly this project's rows.",
        ));
    }
    let mut by_id = existing
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect::<HashMap<_, _>>();
    let mut writes = Vec::with_capacity(ids.len());
    for (sort_order, id) in ids.into_iter().enumerate() {
        let row = by_id.remove(&id).expect("validated State reorder identity");
        let mut active: state::ActiveModel = row.clone().into();
        active.sort_order = Set(sort_order as i32);
        // One fact per moved state: order is a property of each row, so a
        // consumer converges without being told to refetch a list.
        record_workflow_state(
            facts,
            transaction,
            WorkflowStateFact {
                project_id: &project_id,
                state_id: &row.id,
                change: WorkflowStateChange::Reordered,
                name: &row.name,
                group: &row.group,
                color: &row.color,
                sort_order: sort_order as i32,
                occurred_at: &stamp(row.updated_at),
            },
        )
        .await?;
        writes.push((row, active));
    }
    Ok(writes)
}

fn valid_text(value: &str, field: &'static str, max: usize) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CommandError::field(field, "This field may not be blank."));
    }
    if value.chars().count() > max {
        return Err(CommandError::field(
            field,
            format!("Ensure this field has no more than {max} characters."),
        ));
    }
    Ok(value.to_owned())
}
