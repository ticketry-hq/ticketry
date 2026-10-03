use super::super::{
    arrival_rank, fractional_rank,
    identifiers::{database_uuid, new_database_uuid},
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemFact},
    CommandError,
};
use super::{valid_name, CreateWorkItem};
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DatabaseTransaction, EntityTrait, ExprTrait, JoinType, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait, Set, TransactionTrait,
};
use ticketry_entities::{issue, issue_type, module_presentation, project, state};

pub async fn create(
    database: &DatabaseConnection,
    input: CreateWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let transaction = database.begin().await?;
    let id = create_in(&transaction, input, facts).await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

pub(crate) async fn create_in(
    transaction: &DatabaseTransaction,
    input: CreateWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let project_id = database_uuid(&input.project_id, "project_id")?;
    let issue_type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let name = valid_name(&input.name)?;
    // Reserve the SQLite writer before validation reads to avoid upgrading a
    // stale read snapshot when another creator commits between reads and writes.
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(transaction)
        .await?;
    let selected_type = resolve_create_type(transaction, &project_id, &issue_type_id).await?;
    let item_type = selected_type.level.clone();
    let (state_id, parent_id, module_id) = match item_type.as_str() {
        "task" => {
            let state_id =
                resolve_birth_state(transaction, &project_id, &selected_type, input.state_id)
                    .await?;
            let (parent_id, module_id) =
                resolve_parent(transaction, &project_id, input.parent_id).await?;
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

    // Allocate both counters atomically before the insert can become visible.
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
        .exec_with_returning(transaction)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    let sequence_id = counters.seq_counter;
    let state_revision = counters.state_revision;
    let presentation_rank =
        if item_type == "module" && uses_manual_module_order(transaction, &project_id).await? {
            let last = module_presentation::Entity::find()
                .join(
                    JoinType::InnerJoin,
                    module_presentation::Relation::Module.def(),
                )
                .filter(issue::Column::ProjectId.eq(&project_id))
                .filter(issue::Column::Type.eq("module"))
                .filter(issue::Column::IsArchived.eq(false))
                .filter(module_presentation::Column::Rank.ne(""))
                .order_by_desc(module_presentation::Column::Rank)
                .order_by_desc(module_presentation::Column::ModuleId)
                .one(transaction)
                .await?;
            Some(
                fractional_rank::between(last.as_ref().map(|row| row.rank.as_str()), None)
                    .map_err(|_| CommandError::validation("An existing module rank is invalid."))?,
            )
        } else {
            None
        };
    let rank = if item_type == "module" {
        String::new()
    } else {
        arrival_rank::for_work_item(transaction, &project_id, state_id.as_deref()).await?
    };
    let id = new_database_uuid();
    let now = super::super::timestamp::now();
    let occurred_at = stamp(now);
    issue::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(project_id.clone()),
        r#type: Set(item_type),
        issue_type_id: Set(issue_type_id),
        parent_id: Set(parent_id.clone()),
        module_id: Set(module_id.clone()),
        sprint_id: sea_orm::ActiveValue::NotSet,
        state_id: Set(state_id.clone()),
        state_revision: Set(state_revision),
        name: Set(name),
        sequence_id: Set(sequence_id),
        is_archived: Set(false),
        rank: Set(rank),
        description: Set(input.description.unwrap_or_default()),
        workspace_tab_order: Set(serde_json::json!([])),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(transaction)
    .await?;
    if let Some(rank) = presentation_rank {
        module_presentation::ActiveModel {
            module_id: Set(id.clone()),
            rank: Set(rank),
            tab_hidden: Set(false),
        }
        .insert(transaction)
        .await?;
    }
    record_work_item(
        facts,
        transaction,
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
    Ok(id)
}

async fn uses_manual_module_order<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
) -> Result<bool, CommandError> {
    Ok(module_presentation::Entity::find()
        .join(
            JoinType::InnerJoin,
            module_presentation::Relation::Module.def(),
        )
        .filter(issue::Column::ProjectId.eq(project_id))
        .filter(issue::Column::Type.eq("module"))
        .filter(issue::Column::IsArchived.eq(false))
        .filter(module_presentation::Column::Rank.ne(""))
        .one(database)
        .await?
        .is_some())
}

async fn resolve_create_type<C: ConnectionTrait>(
    database: &C,
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

async fn resolve_birth_state<C: ConnectionTrait>(
    database: &C,
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

async fn resolve_parent<C: ConnectionTrait>(
    database: &C,
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
