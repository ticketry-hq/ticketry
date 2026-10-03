use super::super::{
    identifiers::{database_uuid, uuid_spellings},
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity},
    CommandError,
};
use super::next_revision;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, QueryFilter, TransactionTrait,
};
use ticketry_entities::{design_document, issue};

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
    let now = super::super::timestamp::now();
    let occurred_at = stamp(now);
    issue::Entity::delete_by_id(&id).exec(&transaction).await?;
    // The document registry has no foreign key to work items. Rows left behind
    // are the "document-work-item-missing" defect every later launch repairs
    // behind a full recovery snapshot, so remove them with their owner.
    let spellings = uuid_spellings(&id);
    design_document::Entity::delete_many()
        .filter(
            design_document::Column::TaskId
                .is_in(spellings.clone())
                .or(design_document::Column::ModuleId.is_in(spellings)),
        )
        .exec(&transaction)
        .await?;
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
