use super::CommandError;
use sea_orm::{ConnectionTrait, DatabaseTransaction, EntityTrait};
use ticketry_entities::{issue, issue_type};

pub(super) fn validate_name(name: &str) -> Result<(), CommandError> {
    if name.trim().is_empty() || name.trim().chars().count() > 512 {
        return Err(CommandError::field(
            "proposed_name",
            "Enter a name of 1 to 512 characters.",
        ));
    }
    Ok(())
}

pub(super) async fn validate_epic(
    txn: &DatabaseTransaction,
    project_id: &str,
    id: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(id) = id {
        let epic = issue::Entity::find_by_id(id).one(txn).await?.filter(|row| {
            row.project_id == project_id && row.r#type == "module" && !row.is_archived
        });
        if epic.is_none() {
            return Err(CommandError::field(
                "proposed_epic_id",
                "Choose a live epic in this project.",
            ));
        }
    }
    Ok(())
}

pub(super) async fn validate_story<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
    id: &str,
) -> Result<issue::Model, CommandError> {
    let (story, kind) = issue::Entity::find_by_id(id)
        .find_also_related(issue_type::Entity)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".into()))?;
    if story.r#type != "task"
        || story.is_archived
        || story.project_id != project_id
        || !kind.is_some_and(|kind| {
            kind.name == "Story" && kind.level == "task" && kind.project_id == project_id
        })
    {
        return Err(CommandError::field(
            "issue_id",
            "Suggest a live Story in this project.",
        ));
    }
    Ok(story)
}
