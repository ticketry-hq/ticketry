use super::super::CommandError;
use sea_orm::{sea_query::Expr, ColumnTrait, ConnectionTrait, EntityTrait, ExprTrait, QueryFilter};
use ticketry_entities::project;

pub async fn next_revision<C: ConnectionTrait>(
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
