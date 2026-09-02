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
        .col(
            ColumnDef::new(transition_occurrence::Column::Handoff)
                .boolean()
                .not_null()
                .default(false),
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
    let has_handoff = columns.iter().any(|row| {
        row.try_get::<String>("", "name")
            .is_ok_and(|name| name == "handoff")
    });
    if !has_handoff {
        database
            .execute_unprepared(
                "ALTER TABLE worktracker_transitionoccurrence ADD COLUMN handoff bool NOT NULL DEFAULT 0",
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
    pub handoff: bool,
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
        handoff: Set(occurrence.handoff),
        run_now_decision_id: Set(occurrence.run_now_decision_id.map(str::to_owned)),
        committed_at: NotSet,
    }
    .insert(transaction)
    .await?;
    Ok(occurrence_id)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, EntityTrait, TransactionTrait};

    use super::*;
    use crate::work_management::open_for_commands;

    /// A database written before the handoff flag existed: the occurrence table
    /// exists, but without the column.
    const LEGACY_TABLE: &str = "CREATE TABLE worktracker_transitionoccurrence (
            occurrence_id varchar NOT NULL PRIMARY KEY,
            version integer NOT NULL,
            issue_id varchar NOT NULL,
            project_id varchar NOT NULL,
            issue_type_id varchar NOT NULL,
            from_state_id varchar NOT NULL,
            to_state_id varchar NOT NULL,
            from_group varchar NOT NULL,
            to_group varchar NOT NULL,
            work_item_revision bigint NOT NULL,
            workflow_revision integer NOT NULL,
            destination_auto_start boolean NOT NULL,
            run_now_decision_id varchar,
            committed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
        )";

    const LEGACY_ROW: &str = "INSERT INTO worktracker_transitionoccurrence (
            occurrence_id, version, issue_id, project_id, issue_type_id,
            from_state_id, to_state_id, from_group, to_group,
            work_item_revision, workflow_revision, destination_auto_start
        ) VALUES (
            'legacy', 1, 'issue', 'project', 'story',
            'ideas', 'implement', 'backlog', 'started',
            2, 3, 1
        )";

    async fn database(directory: &tempfile::TempDir) -> DatabaseConnection {
        let path = directory.path().join("state.db");
        Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .unwrap()
            .close()
            .await
            .unwrap();
        open_for_commands(&path).await.unwrap()
    }

    /// Upgrading a database whose table predates the flag must add the column
    /// rather than fail, and rows written before the upgrade must read as "no
    /// handoff" instead of refusing to load.
    #[tokio::test]
    async fn ensure_schema_adds_handoff_to_a_table_created_without_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.db");
        let connection = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .unwrap();
        connection.execute_unprepared(LEGACY_TABLE).await.unwrap();
        connection.execute_unprepared(LEGACY_ROW).await.unwrap();

        ensure_schema(&connection).await.unwrap();

        let stored = transition_occurrence::Entity::find_by_id("legacy".to_owned())
            .one(&connection)
            .await
            .unwrap()
            .expect("the pre-upgrade occurrence survives the migration");
        assert!(
            !stored.handoff,
            "a row written before the column existed defaults to no handoff"
        );
    }

    /// The commit path's flag must reach the durable record; if `append`
    /// dropped it, every later reader would see a handoff transition as ordinary.
    #[tokio::test]
    async fn append_persists_the_handoff_flag() {
        let directory = tempfile::tempdir().unwrap();
        let database = database(&directory).await;
        let transaction = database.begin().await.unwrap();
        let occurrence_id = append(
            &transaction,
            NewTransitionOccurrence {
                issue_id: "issue",
                project_id: "project",
                issue_type_id: "story",
                from_state_id: "ideas",
                to_state_id: "implement",
                from_group: "backlog",
                to_group: "started",
                work_item_revision: 2,
                workflow_revision: 3,
                destination_auto_start: false,
                handoff: true,
                run_now_decision_id: None,
            },
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let stored = transition_occurrence::Entity::find_by_id(occurrence_id)
            .one(&database)
            .await
            .unwrap()
            .expect("the appended occurrence");
        assert!(stored.handoff, "append must carry the edge's handoff flag");
    }
}
