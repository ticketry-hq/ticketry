use super::super::{
    identifiers::database_uuid,
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity},
    CommandError,
};
use super::{next_revision, valid_name, UpdateWorkItem};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use ticketry_entities::{issue, issue_type};

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
    let now = super::super::timestamp::now();
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
