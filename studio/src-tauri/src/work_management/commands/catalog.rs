use std::collections::{HashMap, HashSet};

use rand::seq::SliceRandom;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::Deserialize;

use super::identifiers::{database_uuid, new_database_uuid};
use super::status_facts::{
    record_workflow_state, stamp, WorkFactRecorder, WorkflowStateChange, WorkflowStateFact,
};
use super::CommandError;
use crate::work_management::entities::{
    issue, issue_type, issue_type_transition, launch_binding, project, state, workspace,
};

const REVIEWED_DEFAULTS: &str =
    include_str!("../../../../../backend/worktracker/reviewed_defaults.json");
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
    pub workspace_slug: Option<String>,
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
    let selected_workspace = match input.workspace_slug {
        Some(slug) => workspace::Entity::find()
            .filter(workspace::Column::Slug.eq(slug))
            .one(database)
            .await?
            .ok_or_else(|| CommandError::NotFound("Workspace not found.".to_owned()))?,
        None => workspace::Entity::find()
            .order_by_asc(workspace::Column::CreatedAt)
            .one(database)
            .await?
            .ok_or_else(|| {
                CommandError::NotFound("No workspace to create the project under.".to_owned())
            })?,
    };
    if project::Entity::find()
        .filter(project::Column::WorkspaceId.eq(&selected_workspace.id))
        .filter(project::Column::Slug.eq(&slug))
        .one(database)
        .await?
        .is_some()
    {
        return Err(CommandError::Conflict(format!(
            "Project slug '{slug}' already exists."
        )));
    }

    let defaults: Defaults = serde_json::from_str(REVIEWED_DEFAULTS)
        .map_err(|_| CommandError::Storage("Reviewed project defaults are invalid.".to_owned()))?;
    let transaction = database.begin().await?;
    let id = new_database_uuid();
    let now = super::timestamp::now();
    project::ActiveModel {
        id: Set(id.clone()),
        workspace_id: Set(selected_workspace.id),
        name: Set(name),
        slug: Set(slug),
        description: Set(input.description.unwrap_or_default()),
        seq_counter: Set(0),
        state_revision: Set(0),
        manual_module_order: Set(false),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&transaction)
    .await?;

    let mut state_ids = HashMap::new();
    for (sort_order, seed) in defaults.states.iter().enumerate() {
        let state_id = new_database_uuid();
        state_ids.insert(seed.name.clone(), state_id.clone());
        state::ActiveModel {
            id: Set(state_id),
            project_id: Set(id.clone()),
            name: Set(seed.name.clone()),
            group: Set(seed.group.clone()),
            color: Set(seed.color.clone()),
            sort_order: Set(sort_order as i32),
            is_protected: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await?;
    }

    let mut type_ids = HashMap::new();
    for (sort_order, (type_name, level)) in std::iter::once(("Module", "module"))
        .chain(
            defaults
                .issue_types
                .iter()
                .map(|name| (name.as_str(), "task")),
        )
        .enumerate()
    {
        let type_id = new_database_uuid();
        type_ids.insert(type_name.to_owned(), type_id.clone());
        let start_state_id = defaults
            .workflows
            .get(type_name)
            .and_then(|workflow| state_ids.get(&workflow.start))
            .cloned();
        issue_type::ActiveModel {
            id: Set(type_id),
            project_id: Set(id.clone()),
            name: Set(type_name.to_owned()),
            level: Set(level.to_owned()),
            color: Set(String::new()),
            sort_order: Set(sort_order as i32),
            start_state_id: Set(start_state_id),
            workflow_revision: Set(i32::from(level == "task")),
            is_pathfind: Set(type_name == "PathFind"),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await?;
    }

    for (type_name, workflow) in &defaults.workflows {
        let type_id = &type_ids[type_name];
        for (from, to, metadata) in &workflow.transitions {
            issue_type_transition::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_type_id: Set(type_id.clone()),
                from_state_id: Set(state_ids[from].clone()),
                to_state_id: Set(state_ids[to].clone()),
                agent_allowed: Set(metadata.agent_allowed),
            }
            .insert(&transaction)
            .await?;
        }
    }

    for type_name in &defaults.issue_types {
        for state_seed in &defaults.states {
            let prompt = defaults
                .prompts
                .get(type_name)
                .and_then(|prompts| prompts.get(&state_seed.name))
                .cloned()
                .unwrap_or_default();
            let required_skills = defaults
                .required_skills
                .get(&state_seed.name)
                .cloned()
                .unwrap_or_default();
            launch_binding::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_type_id: Set(type_ids[type_name].clone()),
                state_id: Set(state_ids[&state_seed.name].clone()),
                prompt: Set(prompt),
                required_skills: Set(serde_json::json!(required_skills)),
                model_id: Set(None),
                reasoning_id: Set(None),
                auto_start: Set(state_seed.auto_start),
                subtree_run_enabled: Set(type_name == "Story" && state_seed.name != "Ideas"),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&transaction)
            .await?;
        }
    }
    transaction.commit().await?;
    Ok(id)
}

pub async fn acknowledge_onboarding(database: &DatabaseConnection) -> Result<String, CommandError> {
    let row = workspace::Entity::find()
        .order_by_asc(workspace::Column::CreatedAt)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Workspace not found.".to_owned()))?;
    let id = row.id.clone();
    let mut active: workspace::ActiveModel = row.into();
    active.onboarding_required = Set(false);
    active.updated_at = Set(super::timestamp::now());
    active.update(database).await?;
    Ok(id)
}

pub async fn update_project(
    database: &DatabaseConnection,
    input: UpdateProject,
) -> Result<String, CommandError> {
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
    active.update(database).await?;
    Ok(id)
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
    let project_id = database_uuid(&input.project_id, "project_id")?;
    let name = valid_text(&input.name, "name", 255)?;
    if !GROUPS.contains(&input.group.as_str()) {
        return Err(CommandError::validation(format!(
            "Unknown group '{}'.",
            input.group
        )));
    }
    let transaction = database.begin().await?;
    // Match Django's select_for_update boundary. The no-op UPDATE is the
    // portable SQLite writer reservation before color and order are observed.
    if project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(&transaction)
        .await?
        .rows_affected
        == 0
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let existing = state::Entity::find()
        .filter(state::Column::ProjectId.eq(&project_id))
        .all(&transaction)
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
    state::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(project_id.clone()),
        name: Set(name.clone()),
        group: Set(input.group.clone()),
        color: Set(color.clone()),
        sort_order: Set(sort_order),
        is_protected: Set(false),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    }
    .insert(&transaction)
    .await?;
    record_workflow_state(
        facts,
        &transaction,
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
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub async fn update_issue_type(
    database: &DatabaseConnection,
    input: UpdateIssueType,
) -> Result<String, CommandError> {
    let id = database_uuid(&input.id, "issue_type_id")?;
    let transaction = database.begin().await?;
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
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Issue type not found.".to_owned()))?;
    if let Some(name) = input.name.as_deref() {
        let name = valid_text(name, "name", 255)?;
        if issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(&row.project_id))
            .filter(issue_type::Column::Name.eq(&name))
            .filter(issue_type::Column::Id.ne(&id))
            .one(&transaction)
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
    active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(id)
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
    let in_use = super::super::entities::issue::Entity::find()
        .filter(super::super::entities::issue::Column::IssueTypeId.eq(&id))
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
    let id = database_uuid(&input.id, "state_id")?;
    let row = state::Entity::find_by_id(&id)
        .one(database)
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
    // The fact is published from the row that committed, so a rename, recolour,
    // regroup, or reorder reaches consumers as one authoritative version.
    let transaction = database.begin().await?;
    let updated = active.update(&transaction).await?;
    record_workflow_state(
        facts,
        &transaction,
        WorkflowStateFact {
            project_id: &project_id,
            state_id: &updated.id,
            change: WorkflowStateChange::Updated,
            name: &updated.name,
            group: &updated.group,
            color: &updated.color,
            sort_order: updated.sort_order,
            occurred_at: &occurred_at,
        },
    )
    .await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub async fn reorder_issue_types(
    database: &DatabaseConnection,
    project_id: &str,
    ordered_ids: Vec<String>,
) -> Result<(), CommandError> {
    reorder_catalogue(
        database,
        project_id,
        ordered_ids,
        Catalogue::IssueTypes,
        None,
    )
    .await
}

pub async fn reorder_states(
    database: &DatabaseConnection,
    project_id: &str,
    ordered_ids: Vec<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    reorder_catalogue(database, project_id, ordered_ids, Catalogue::States, facts).await
}

#[derive(Clone, Copy)]
enum Catalogue {
    IssueTypes,
    States,
}

async fn reorder_catalogue(
    database: &DatabaseConnection,
    project_id: &str,
    ordered_ids: Vec<String>,
    catalogue: Catalogue,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let project_id = database_uuid(project_id, "project_id")?;
    let ids = ordered_ids
        .iter()
        .map(|id| database_uuid(id, "ordered_ids"))
        .collect::<Result<Vec<_>, _>>()?;
    let transaction = database.begin().await?;
    if project::Entity::update_many()
        .col_expr(
            project::Column::UpdatedAt,
            Expr::col(project::Column::UpdatedAt),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(&transaction)
        .await?
        .rows_affected
        == 0
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let existing = match catalogue {
        Catalogue::IssueTypes => issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(&project_id))
            .all(&transaction)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<HashSet<_>>(),
        Catalogue::States => state::Entity::find()
            .filter(state::Column::ProjectId.eq(&project_id))
            .all(&transaction)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<HashSet<_>>(),
    };
    if existing.len() != ids.len()
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        || !ids.iter().all(|id| existing.contains(id))
    {
        return Err(CommandError::validation(
            "ordered_ids must be exactly this project's rows.",
        ));
    }
    for (sort_order, id) in ids.into_iter().enumerate() {
        match catalogue {
            Catalogue::IssueTypes => {
                issue_type::Entity::update_many()
                    .col_expr(
                        issue_type::Column::SortOrder,
                        Expr::value(sort_order as i32),
                    )
                    .filter(issue_type::Column::Id.eq(id))
                    .exec(&transaction)
                    .await?;
            }
            Catalogue::States => {
                let updated = state::Entity::update_many()
                    .col_expr(state::Column::SortOrder, Expr::value(sort_order as i32))
                    .filter(state::Column::Id.eq(&id))
                    .exec_with_returning(&transaction)
                    .await?;
                // One fact per moved state: order is a property of each row, so
                // a consumer converges without being told to refetch a list.
                for row in &updated {
                    record_workflow_state(
                        facts,
                        &transaction,
                        WorkflowStateFact {
                            project_id: &project_id,
                            state_id: &row.id,
                            change: WorkflowStateChange::Reordered,
                            name: &row.name,
                            group: &row.group,
                            color: &row.color,
                            sort_order: row.sort_order,
                            occurred_at: &stamp(row.updated_at),
                        },
                    )
                    .await?;
                }
            }
        }
    }
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(())
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Defaults {
    states: Vec<StateSeed>,
    issue_types: Vec<String>,
    required_skills: HashMap<String, Vec<String>>,
    prompts: HashMap<String, HashMap<String, String>>,
    workflows: HashMap<String, WorkflowSeed>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateSeed {
    name: String,
    group: String,
    color: String,
    #[serde(default)]
    auto_start: bool,
}

#[derive(Deserialize)]
struct WorkflowSeed {
    start: String,
    transitions: Vec<(String, String, TransitionSeed)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionSeed {
    #[serde(default = "allowed")]
    agent_allowed: bool,
}

fn allowed() -> bool {
    true
}
