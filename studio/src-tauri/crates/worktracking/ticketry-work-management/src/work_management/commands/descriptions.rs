use crate::work_management::database::begin_write;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QuerySelect, QueryTrait, Set,
};

use super::identifiers::database_uuid;
use super::status_facts::{
    record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity,
};
use super::{work_items, CommandError};
use ticketry_entities::{issue, project};

#[derive(Debug, Clone)]
pub struct AppendDescription {
    pub id: String,
    pub new_content: String,
}

pub async fn append_description(
    database: &DatabaseConnection,
    input: AppendDescription,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let id = database_uuid(&input.id, "id")?;
    let transaction = begin_write(database).await?;
    // Reserve SQLite's writer before reading the description. If two appends
    // read first, both deferred transactions can later contend while upgrading
    // to writers and one receives SQLITE_BUSY instead of observing the other.
    let project_id = issue::Entity::find_by_id(&id)
        .select_only()
        .column(issue::Column::ProjectId)
        .into_query();
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.in_subquery(project_id))
        .exec(&transaction)
        .await?;
    let existing = issue::Entity::find_by_id(&id)
        .filter(issue::Column::Type.eq("task"))
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let description = if existing.description.is_empty() {
        input.new_content
    } else {
        format!("{}\n\n{}", existing.description, input.new_content)
    };
    let revision = work_items::next_revision(&transaction, &existing.project_id).await?;
    let identity = WorkItemIdentity::of(&existing);
    let now = super::timestamp::now();
    let occurred_at = stamp(now);
    let mut active: issue::ActiveModel = existing.into();
    active.description = Set(description);
    active.state_revision = Set(revision);
    active.updated_at = Set(now);
    active.update(&transaction).await?;
    // Open tickets converge only through this fact, as for any other edit.
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
