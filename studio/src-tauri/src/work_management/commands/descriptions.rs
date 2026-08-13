use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    Set, TransactionTrait,
};

use super::identifiers::database_uuid;
use super::{work_items, CommandError};
use crate::work_management::entities::{issue, project};

#[derive(Debug, Clone)]
pub struct AppendDescription {
    pub id: String,
    pub new_content: String,
}

pub async fn append_description(
    database: &DatabaseConnection,
    input: AppendDescription,
) -> Result<String, CommandError> {
    let id = database_uuid(&input.id, "id")?;
    let transaction = database.begin().await?;
    let existing = issue::Entity::find_by_id(&id)
        .filter(issue::Column::Type.eq("task"))
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&existing.project_id))
        .exec(&transaction)
        .await?;
    let description = if existing.description.is_empty() {
        input.new_content
    } else {
        format!("{}\n\n{}", existing.description, input.new_content)
    };
    let revision = work_items::next_revision(&transaction, &existing.project_id).await?;
    let mut active: issue::ActiveModel = existing.into();
    active.description = Set(description);
    active.state_revision = Set(revision);
    active.updated_at = Set(super::timestamp::now());
    active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(id)
}
