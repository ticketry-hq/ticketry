use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::identifiers::database_uuid;
use super::status_facts::WorkFactRecorder;
use super::{work_items, CommandError};
use ticketry_entities::{issue, issue_blocker, issue_type, project, state};

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
    facts: Option<&WorkFactRecorder>,
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
    let predecessor = issue::Entity::find()
        .filter(issue::Column::ParentId.eq(&parent.id))
        .filter(issue::Column::IssueTypeId.eq(&implementation.id))
        .order_by_desc(issue::Column::SequenceId)
        .one(&transaction)
        .await?;
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
    let id = work_items::create_in(
        &transaction,
        work_items::CreateWorkItem {
            project_id,
            name,
            issue_type_id: implementation.id,
            description: Some(description.join("\n")),
            state_id: None,
            parent_id: Some(parent.id),
        },
        facts,
    )
    .await?;
    if let Some(predecessor) = predecessor {
        issue_blocker::ActiveModel {
            id: sea_orm::ActiveValue::NotSet,
            from_issue_id: Set(id.clone()),
            to_issue_id: Set(predecessor.id),
        }
        .insert(&transaction)
        .await?;
    }
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

fn invalid_parent() -> CommandError {
    CommandError::Rejected {
        message: "Review findings require a Story in Review.".to_owned(),
        code: "invalid_review_parent",
        field: Some("parent_id"),
    }
}
