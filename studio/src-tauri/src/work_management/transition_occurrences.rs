use sea_orm::{
    sea_query::{ColumnDef, Expr, Index, Table},
    ActiveModelTrait, ConnectionTrait, DatabaseTransaction, NotSet, Set,
};

use crate::work_management::commands::CommandError;
use crate::work_management::entities::transition_occurrence;

pub(crate) async fn ensure_schema(database: &impl ConnectionTrait) -> Result<(), sea_orm::DbErr> {
    let table = Table::create()
        .table(transition_occurrence::Entity)
        .if_not_exists()
        .col(
            ColumnDef::new(transition_occurrence::Column::OccurrenceId)
                .string()
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::Version)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::IssueId)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::ProjectId)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::IssueTypeId)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::FromStateId)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::ToStateId)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::FromGroup)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::ToGroup)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::WorkItemRevision)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::WorkflowRevision)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::DestinationAutoStart)
                .boolean()
                .not_null(),
        )
        .col(
            ColumnDef::new(transition_occurrence::Column::CommittedAt)
                .date_time()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .to_owned();
    database.execute(&table).await?;
    let index = Index::create()
        .name("idx_transition_occurrence_pending")
        .table(transition_occurrence::Entity)
        .col(transition_occurrence::Column::DestinationAutoStart)
        .col(transition_occurrence::Column::CommittedAt)
        .col(transition_occurrence::Column::OccurrenceId)
        .if_not_exists()
        .to_owned();
    database.execute(&index).await?;
    Ok(())
}

pub(crate) struct NewTransitionOccurrence<'a> {
    pub issue_id: &'a str,
    pub project_id: &'a str,
    pub issue_type_id: &'a str,
    pub from_state_id: &'a str,
    pub to_state_id: &'a str,
    pub from_group: &'a str,
    pub to_group: &'a str,
    pub work_item_revision: i64,
    pub workflow_revision: i32,
    pub destination_auto_start: bool,
}

pub(crate) async fn append(
    transaction: &DatabaseTransaction,
    occurrence: NewTransitionOccurrence<'_>,
) -> Result<String, CommandError> {
    let occurrence_id = uuid::Uuid::new_v4().simple().to_string();
    transition_occurrence::ActiveModel {
        occurrence_id: Set(occurrence_id.clone()),
        version: Set(1),
        issue_id: Set(occurrence.issue_id.to_owned()),
        project_id: Set(occurrence.project_id.to_owned()),
        issue_type_id: Set(occurrence.issue_type_id.to_owned()),
        from_state_id: Set(occurrence.from_state_id.to_owned()),
        to_state_id: Set(occurrence.to_state_id.to_owned()),
        from_group: Set(occurrence.from_group.to_owned()),
        to_group: Set(occurrence.to_group.to_owned()),
        work_item_revision: Set(occurrence.work_item_revision),
        workflow_revision: Set(occurrence.workflow_revision),
        destination_auto_start: Set(occurrence.destination_auto_start),
        committed_at: NotSet,
    }
    .insert(transaction)
    .await?;
    Ok(occurrence_id)
}
