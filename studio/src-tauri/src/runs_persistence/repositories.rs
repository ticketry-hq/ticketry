use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, ColumnTrait,
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect,
};
use serde_json::Value;

use super::entities::{
    agent_run as agent_run_entity, automation_attempt as automation_attempt_entity,
    launch_effect as launch_effect_entity,
    project_compaction_watermark as compaction_watermark_entity,
    status_event as status_event_entity,
};
use super::{
    AgentRunRecord, AutomationAttemptRecord, LaunchEffectRecord, RunsPersistenceError,
    RunsPersistenceErrorCode, StatusEventRecord,
};

#[derive(Clone)]
pub struct AgentRunRepository(DatabaseConnection);

impl AgentRunRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
    }

    pub async fn find(&self, id: &str) -> Result<Option<AgentRunRecord>, RunsPersistenceError> {
        Ok(agent_run_entity::Entity::find_by_id(id)
            .filter(agent_run_entity::Column::Agent.is_not_null())
            .one(&self.0)
            .await?
            .and_then(agent_run))
    }
}

#[derive(Clone)]
pub struct AutomationAttemptRepository(DatabaseConnection);

impl AutomationAttemptRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
    }

    pub async fn find(
        &self,
        id: &str,
    ) -> Result<Option<AutomationAttemptRecord>, RunsPersistenceError> {
        let database_id = database_uuid(id);
        let row = find_attempt(&self.0, &database_id).await?;
        Ok(row.map(automation_attempt))
    }
}

pub(crate) async fn find_attempt(
    database: &impl ConnectionTrait,
    id: &str,
) -> Result<Option<automation_attempt_entity::Model>, RunsPersistenceError> {
    Ok(automation_attempt_entity::Entity::find_by_id(id)
        .one(database)
        .await?)
}

pub struct NewStatusEvent<'a> {
    pub event_id: &'a str,
    pub project_id: &'a str,
    pub event_kind: &'a str,
    pub payload_version: i32,
    pub subject_kind: &'a str,
    pub subject_id: &'a str,
    pub agent_run_id: Option<&'a str>,
    pub automation_attempt_id: Option<&'a str>,
    pub work_item_id: Option<&'a str>,
    pub payload: &'a Value,
}

#[derive(Clone)]
pub struct StatusEventRepository {
    database: DatabaseConnection,
    wakeup: super::status_wakeup::StatusWakeup,
}

impl StatusEventRepository {
    pub(crate) fn new(
        database: DatabaseConnection,
        wakeup: super::status_wakeup::StatusWakeup,
    ) -> Self {
        Self { database, wakeup }
    }

    /// Wake registered subscribers. Callers invoke this only after their
    /// transaction commits, so a rolled-back command publishes nothing and a
    /// failed publication cannot roll back committed truth.
    pub(crate) fn wake_committed(&self) {
        self.wakeup.publish();
    }

    pub async fn append(
        &self,
        transaction: &DatabaseTransaction,
        event: NewStatusEvent<'_>,
    ) -> Result<i64, RunsPersistenceError> {
        if !event.payload.is_object() || event.payload_version <= 0 {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidHistory,
                "status events require an object payload and positive payload version",
            ));
        }
        let row = status_event_entity::ActiveModel {
            cursor: NotSet,
            event_id: Set(event.event_id.to_owned()),
            project_id: Set(database_uuid(event.project_id)),
            event_kind: Set(event.event_kind.to_owned()),
            payload_version: Set(event.payload_version),
            subject_kind: Set(event.subject_kind.to_owned()),
            subject_id: Set(event.subject_id.to_owned()),
            agent_run_id: Set(event.agent_run_id.map(str::to_owned)),
            automation_attempt_id: Set(event.automation_attempt_id.map(str::to_owned)),
            work_item_id: Set(event.work_item_id.map(database_uuid)),
            payload: Set(event.payload.to_string()),
            committed_at: NotSet,
        }
        .insert(transaction)
        .await?;
        Ok(row.cursor)
    }

    pub async fn high_water(&self) -> Result<i64, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .order_by_desc(status_event_entity::Column::Cursor)
            .one(&self.database)
            .await?
            .map(|row| row.cursor)
            .unwrap_or(0))
    }

    pub async fn replay(
        &self,
        project_id: &str,
        after: i64,
        through: i64,
        limit: u64,
    ) -> Result<Vec<StatusEventRecord>, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .filter(status_event_entity::Column::Cursor.gt(after))
            .filter(status_event_entity::Column::Cursor.lte(through))
            .order_by_asc(status_event_entity::Column::Cursor)
            .limit(limit)
            .all(&self.database)
            .await?
            .into_iter()
            .map(status_event)
            .collect())
    }

    /// Every project that still holds retained history. Compaction is
    /// project-aware, so it walks these rather than the global cursor space.
    pub async fn projects_with_events(&self) -> Result<Vec<String>, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .select_only()
            .column(status_event_entity::Column::ProjectId)
            .group_by(status_event_entity::Column::ProjectId)
            .into_tuple::<String>()
            .all(&self.database)
            .await?)
    }

    /// The newest cursor for one project that is outside the newest
    /// `keep_newest` rows. Everything at or below it has lost the count
    /// protection; `None` means the project has not accumulated enough history
    /// for any row to lose it.
    pub async fn count_retention_floor(
        &self,
        project_id: &str,
        keep_newest: u64,
    ) -> Result<Option<i64>, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .select_only()
            .column(status_event_entity::Column::Cursor)
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .order_by_desc(status_event_entity::Column::Cursor)
            .offset(keep_newest)
            .limit(1)
            .into_tuple::<i64>()
            .one(&self.database)
            .await?)
    }

    /// The newest cursor for one project committed strictly before `before`.
    /// Everything at or below it has lost the age protection.
    pub async fn age_retention_floor(
        &self,
        project_id: &str,
        before: &str,
    ) -> Result<Option<i64>, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .select_only()
            .column(status_event_entity::Column::Cursor)
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .filter(status_event_entity::Column::CommittedAt.lt(before))
            .order_by_desc(status_event_entity::Column::Cursor)
            .limit(1)
            .into_tuple::<i64>()
            .one(&self.database)
            .await?)
    }

    /// Delete at most `batch` of one project's rows at or below `through`, in
    /// cursor order. Compaction repeats this so a large backlog never holds one
    /// long transaction open against live writers.
    pub async fn delete_through(
        &self,
        project_id: &str,
        through: i64,
        batch: u64,
    ) -> Result<u64, RunsPersistenceError> {
        let cursors: Vec<i64> = status_event_entity::Entity::find()
            .select_only()
            .column(status_event_entity::Column::Cursor)
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .filter(status_event_entity::Column::Cursor.lte(through))
            .order_by_asc(status_event_entity::Column::Cursor)
            .limit(batch)
            .into_tuple::<i64>()
            .all(&self.database)
            .await?;
        if cursors.is_empty() {
            return Ok(0);
        }
        let deleted = status_event_entity::Entity::delete_many()
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .filter(status_event_entity::Column::Cursor.is_in(cursors))
            .exec(&self.database)
            .await?;
        Ok(deleted.rows_affected)
    }

    /// How many rows one project still retains. Used by compaction evidence and
    /// by the bounded-memory tests.
    pub async fn count_for_project(&self, project_id: &str) -> Result<u64, RunsPersistenceError> {
        Ok(status_event_entity::Entity::find()
            .filter(status_event_entity::Column::ProjectId.eq(project_id))
            .count(&self.database)
            .await?)
    }
}

fn database_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

#[derive(Clone)]
pub struct CompactionWatermarkRepository(DatabaseConnection);

impl CompactionWatermarkRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
    }

    pub async fn get(&self, project_id: &str) -> Result<i64, RunsPersistenceError> {
        Ok(compaction_watermark_entity::Entity::find_by_id(project_id)
            .one(&self.0)
            .await?
            .map(|row| row.compacted_through_cursor)
            .unwrap_or(0))
    }

    pub async fn advance(
        &self,
        transaction: &DatabaseTransaction,
        project_id: &str,
        through: i64,
    ) -> Result<(), RunsPersistenceError> {
        if through < 0 {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidHistory,
                "compaction watermark cannot be negative",
            ));
        }
        // The insert seeds a project's first watermark; the conditional update
        // below is what advances an existing one. A conflict is therefore the
        // ordinary path for every pass after the first, and SeaORM reports a
        // `do_nothing` conflict as `RecordNotInserted` rather than as a row
        // count, so it is not an error here.
        match compaction_watermark_entity::Entity::insert(
            compaction_watermark_entity::ActiveModel {
                project_id: Set(project_id.to_owned()),
                compacted_through_cursor: Set(through),
                updated_at: NotSet,
            },
        )
        .on_conflict(
            OnConflict::column(compaction_watermark_entity::Column::ProjectId)
                .do_nothing()
                .to_owned(),
        )
        .exec(transaction)
        .await
        {
            Ok(_) | Err(DbErr::RecordNotInserted) => {}
            Err(error) => return Err(error.into()),
        }
        compaction_watermark_entity::Entity::update_many()
            .col_expr(
                compaction_watermark_entity::Column::CompactedThroughCursor,
                sea_orm::sea_query::Expr::value(through),
            )
            .col_expr(
                compaction_watermark_entity::Column::UpdatedAt,
                sea_orm::sea_query::Expr::current_timestamp(),
            )
            .filter(compaction_watermark_entity::Column::ProjectId.eq(project_id))
            .filter(compaction_watermark_entity::Column::CompactedThroughCursor.lt(through))
            .exec(transaction)
            .await?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct LaunchEffectRepository(DatabaseConnection);

impl LaunchEffectRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
    }

    pub async fn find(
        &self,
        effect_id: &str,
    ) -> Result<Option<LaunchEffectRecord>, RunsPersistenceError> {
        Ok(launch_effect_entity::Entity::find_by_id(effect_id)
            .one(&self.0)
            .await?
            .map(launch_effect))
    }
}

fn agent_run(row: agent_run_entity::Model) -> Option<AgentRunRecord> {
    Some(AgentRunRecord {
        id: row.id,
        issue_id: row.issue_id,
        ticket_seq: row.ticket_seq,
        agent: row.agent,
        model: row.launch_model.clone(),
        reasoning: row.launch_reasoning.clone(),
        status: row.status,
        started_at: row.started_at,
        ended_at: row.ended_at,
        exit_code: row.exit_code,
        error: row.error,
        cwd: row.cwd,
        provider_session_id: row.provider_session_id,
        lifecycle_state: row.lifecycle_state,
        lifecycle_updated_at: row.lifecycle_updated_at,
        design_dir: row.design_dir,
        resumed_from: row.resumed_from,
        scope: row.scope,
        launch_state: row.launch_state,
        launch_model: row.launch_model,
    })
}

pub(crate) fn automation_attempt(row: automation_attempt_entity::Model) -> AutomationAttemptRecord {
    AutomationAttemptRecord {
        id: row.id,
        transition_id: row.transition_id,
        issue_id: row.issue_id,
        from_state_id: row.from_state_id,
        to_state_id: row.to_state_id,
        workflow_revision: row.workflow_revision,
        status: row.status,
        agent: row.agent,
        agent_run_id: row.agent_run_id,
        error: row.error,
        error_details: row.error_details,
        retryable: row.retryable,
        dismissed_at: row.dismissed_at,
        retry_of_id: row.retry_of_id,
        root_attempt_id: row.root_attempt_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn status_event(row: status_event_entity::Model) -> StatusEventRecord {
    StatusEventRecord {
        cursor: row.cursor,
        event_id: row.event_id,
        project_id: row.project_id,
        event_kind: row.event_kind,
        payload_version: row.payload_version,
        subject_kind: row.subject_kind,
        subject_id: row.subject_id,
        agent_run_id: row.agent_run_id,
        automation_attempt_id: row.automation_attempt_id,
        work_item_id: row.work_item_id,
        payload: row.payload,
        committed_at: row.committed_at,
    }
}

pub(crate) fn launch_effect(row: launch_effect_entity::Model) -> LaunchEffectRecord {
    LaunchEffectRecord {
        effect_id: row.effect_id,
        agent_run_id: row.agent_run_id,
        automation_attempt_id: row.automation_attempt_id,
        request_id: row.request_id,
        project_id: row.project_id,
        issue_id: row.issue_id,
        scope: row.scope,
        provider: row.provider,
        target_kind: row.target_kind,
        target_id: row.target_id,
        policy_reference: row.policy_reference,
        state: row.state,
        lease_owner: row.lease_owner,
        lease_expires_at: row.lease_expires_at,
        attempt_count: row.attempt_count,
        last_error_code: row.last_error_code,
        last_error_message: row.last_error_message,
        runtime_evidence: row.runtime_evidence,
        created_at: row.created_at,
        updated_at: row.updated_at,
        applied_at: row.applied_at,
    }
}
