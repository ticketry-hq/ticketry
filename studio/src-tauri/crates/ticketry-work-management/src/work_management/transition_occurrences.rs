use sea_orm::{
    sea_query::{ColumnDef, Expr, Index, Table},
    ActiveModelTrait, ConnectionTrait, DatabaseTransaction, DbBackend, NotSet, Set, Statement,
};

use crate::work_management::commands::CommandError;
use ticketry_entities::transition_occurrence;

pub async fn ensure_schema(database: &impl ConnectionTrait) -> Result<(), sea_orm::DbErr> {
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
        .col(ColumnDef::new(transition_occurrence::Column::RunNowDecisionId).string())
        .col(
            ColumnDef::new(transition_occurrence::Column::CommittedAt)
                .date_time()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .to_owned();
    database.execute(&table).await?;
    let columns = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_transitionoccurrence)".to_owned(),
        ))
        .await?;
    let has_run_now_claim = columns.iter().any(|row| {
        row.try_get::<String>("", "name")
            .is_ok_and(|name| name == "run_now_decision_id")
    });
    if !has_run_now_claim {
        database
            .execute_unprepared(
                "ALTER TABLE worktracker_transitionoccurrence ADD COLUMN run_now_decision_id varchar",
            )
            .await?;
    }
    let index = Index::create()
        .name("idx_transition_occurrence_pending")
        .table(transition_occurrence::Entity)
        .col(transition_occurrence::Column::DestinationAutoStart)
        .col(transition_occurrence::Column::CommittedAt)
        .col(transition_occurrence::Column::OccurrenceId)
        .if_not_exists()
        .to_owned();
    database.execute(&index).await?;
    let claim_index = Index::create()
        .name("idx_transition_occurrence_run_now_claim")
        .table(transition_occurrence::Entity)
        .col(transition_occurrence::Column::RunNowDecisionId)
        .unique()
        .if_not_exists()
        .to_owned();
    database.execute(&claim_index).await?;
    Ok(())
}

pub struct NewTransitionOccurrence<'a> {
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
    pub run_now_decision_id: Option<&'a str>,
}

pub async fn append(
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
        run_now_decision_id: Set(occurrence.run_now_decision_id.map(str::to_owned)),
        committed_at: NotSet,
    }
    .insert(transaction)
    .await?;
    Ok(occurrence_id)
}
