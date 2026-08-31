use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::fractional_rank;
use super::identifiers::{database_uuid, new_database_uuid};
use super::{work_items, CommandError};
use crate::entities::work_management::{issue, issue_type, project, state};

#[derive(Debug, Clone)]
pub struct CreateReviewFinding {
    pub project_id: String,
    pub parent_id: String,
    pub name: String,
    pub path: String,
    pub line_start: i64,
    pub line_end: i64,
    pub note: Option<String>,
}

pub async fn create_review_finding(
    database: &DatabaseConnection,
    input: CreateReviewFinding,
) -> Result<String, CommandError> {
    let project_id = database_uuid(&input.project_id, "project_id")?;
    let parent_id = database_uuid(&input.parent_id, "parent_id")?;
    let name = work_items::valid_name(&input.name)?;
    let path = input.path.trim().to_owned();
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\n')
        || path.contains('\r')
        || path.split('/').any(|part| part == "..")
    {
        return Err(CommandError::Rejected {
            message: format!("Implausible repo-relative path {path:?}."),
            code: "malformed_path",
            field: Some("path"),
        });
    }
    if input.line_start < 1 || input.line_end < input.line_start {
        return Err(CommandError::Rejected {
            message: format!(
                "Line range {}-{} is not an inclusive positive range (expect 1 <= start <= end).",
                input.line_start, input.line_end
            ),
            code: "malformed_range",
            field: Some("line_start"),
        });
    }

    let transaction = database.begin().await?;
    let reservation = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(&transaction)
        .await?;
    if reservation.rows_affected == 0 {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let parent = issue::Entity::find_by_id(&parent_id)
        .one(&transaction)
        .await?
        .filter(|row| row.r#type == "task" && row.project_id == project_id)
        .ok_or_else(|| invalid_parent())?;
    let parent_kind = issue_type::Entity::find_by_id(&parent.issue_type_id)
        .one(&transaction)
        .await?;
    let parent_state = match &parent.state_id {
        Some(id) => state::Entity::find_by_id(id).one(&transaction).await?,
        None => None,
    };
    if parent_kind.is_none_or(|kind| kind.name != "Story")
        || parent_state.is_none_or(|state| state.name != "Review")
    {
        return Err(invalid_parent());
    }
    let implementation = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(&project_id))
        .filter(issue_type::Column::Name.eq("Implementation"))
        .filter(issue_type::Column::Level.eq("task"))
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Implementation issue type not found.".to_owned()))?;
    let state_id = if let Some(start_id) = &implementation.start_state_id {
        state::Entity::find_by_id(start_id)
            .filter(state::Column::ProjectId.eq(&project_id))
            .one(&transaction)
            .await?
            .map(|row| row.id)
            .ok_or_else(|| CommandError::IllegalBirth {
                message: "The published workflow start state no longer exists.".to_owned(),
                to_state: None,
            })?
            .into()
    } else {
        state::Entity::find()
            .filter(state::Column::ProjectId.eq(&project_id))
            .filter(state::Column::Group.eq("backlog"))
            .order_by_asc(state::Column::SortOrder)
            .order_by_asc(state::Column::CreatedAt)
            .one(&transaction)
            .await?
            .map(|row| row.id)
    };
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
        .exec_with_returning(&transaction)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    let sequence_id = counters.seq_counter;
    let state_revision = counters.state_revision;
    let tail = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&project_id))
        .filter(issue::Column::Rank.ne(""))
        .order_by_desc(issue::Column::Rank)
        .one(&transaction)
        .await?;
    let rank = fractional_rank::between(tail.as_ref().map(|row| row.rank.as_str()), None)
        .map_err(|_| CommandError::validation("An existing work-item rank is invalid."))?;
    let mut description = vec![
        format!("Path: {path}"),
        format!("Lines: {}-{}", input.line_start, input.line_end),
    ];
    if let Some(note) = input
        .note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty())
    {
        description.push(format!("Note: {note}"));
    }
    let id = new_database_uuid();
    let now = super::timestamp::now();
    issue::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(project_id),
        r#type: Set("task".to_owned()),
        issue_type_id: Set(implementation.id),
        parent_id: Set(Some(parent.id)),
        module_id: Set(parent.module_id),
        state_id: Set(state_id),
        state_revision: Set(state_revision),
        name: Set(name),
        sequence_id: Set(sequence_id),
        is_archived: Set(false),
        rank: Set(rank),
        description: Set(description.join("\n")),
        workspace_tab_order: Set(serde_json::json!([])),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&transaction)
    .await?;
    transaction.commit().await?;
    Ok(id)
}

fn invalid_parent() -> CommandError {
    CommandError::Rejected {
        message: "Review findings require a Story in Review.".to_owned(),
        code: "invalid_review_parent",
        field: Some("parent_id"),
    }
}
