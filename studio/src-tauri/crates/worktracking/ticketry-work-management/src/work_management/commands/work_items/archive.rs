use super::super::{
    identifiers::database_uuid,
    status_facts::{
        record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemFact, WorkItemIdentity,
    },
    CommandError,
};
use super::next_revision;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use ticketry_entities::issue;

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
    let now = super::super::timestamp::now();
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
