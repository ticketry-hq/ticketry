use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, ColumnTrait,
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use serde_json::Value;

use super::entities::{
    agent_run as agent_run_entity, automation_attempt as automation_attempt_entity,
    launch_effect as launch_effect_entity,
    project_compaction_watermark as compaction_watermark_entity,
    status_event as status_event_entity,
};
use super::work_item_scope;
use super::{
    AgentRunRecord, AutomationAttemptRecord, LaunchEffectRecord, LaunchIntent,
    RunsPersistenceError, RunsPersistenceErrorCode, StatusEventRecord,
};

#[derive(Clone)]
pub struct AgentRunRepository(DatabaseConnection);

impl AgentRunRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
    }

    pub async fn find(&self, id: &str) -> Result<Option<AgentRunRecord>, RunsPersistenceError> {
        Ok(agent_run_entity::Entity::find_by_id(id)
            .one(&self.0)
            .await?
            .map(agent_run))
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
        let database_id = uuid::Uuid::parse_str(id)
            .map(|value| value.simple().to_string())
            .unwrap_or_else(|_| id.to_owned());
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
pub struct StatusEventRepository(DatabaseConnection);

impl StatusEventRepository {
    pub(crate) fn new(database: DatabaseConnection) -> Self {
        Self(database)
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
            project_id: Set(event.project_id.to_owned()),
            event_kind: Set(event.event_kind.to_owned()),
            payload_version: Set(event.payload_version),
            subject_kind: Set(event.subject_kind.to_owned()),
            subject_id: Set(event.subject_id.to_owned()),
            agent_run_id: Set(event.agent_run_id.map(str::to_owned)),
            automation_attempt_id: Set(event.automation_attempt_id.map(str::to_owned)),
            work_item_id: Set(event.work_item_id.map(str::to_owned)),
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
            .one(&self.0)
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
            .all(&self.0)
            .await?
            .into_iter()
            .map(status_event)
            .collect())
    }
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
        compaction_watermark_entity::Entity::insert(compaction_watermark_entity::ActiveModel {
            project_id: Set(project_id.to_owned()),
            compacted_through_cursor: Set(through),
            updated_at: NotSet,
        })
        .on_conflict(
            OnConflict::column(compaction_watermark_entity::Column::ProjectId)
                .do_nothing()
                .to_owned(),
        )
        .exec(transaction)
        .await?;
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

    pub async fn prepare(
        &self,
        transaction: &DatabaseTransaction,
        intent: &LaunchIntent,
    ) -> Result<(), RunsPersistenceError> {
        intent.validate()?;
        validate_intent_scope(transaction, intent).await?;
        launch_effect_entity::ActiveModel {
            effect_id: Set(intent.effect_id.clone()),
            intent_version: NotSet,
            agent_run_id: Set(intent.agent_run_id.clone()),
            automation_attempt_id: Set(intent.automation_attempt_id.clone()),
            request_id: Set(intent.request_id.clone()),
            project_id: Set(intent.project_id.clone()),
            issue_id: Set(intent.issue_id.clone()),
            scope: Set(intent.scope.clone()),
            provider: Set(intent.provider.clone()),
            target_kind: Set(intent.target_kind.clone()),
            target_id: Set(intent.target_id.clone()),
            policy_reference: Set(intent.policy_reference.clone()),
            state: NotSet,
            lease_owner: NotSet,
            lease_expires_at: NotSet,
            attempt_count: NotSet,
            last_error_code: NotSet,
            last_error_message: NotSet,
            runtime_evidence: NotSet,
            created_at: NotSet,
            updated_at: NotSet,
            applied_at: NotSet,
        }
        .insert(transaction)
        .await
        .map_err(|error| {
            RunsPersistenceError::storage(
                "launch effect conflicts with existing durable identity",
                error,
            )
        })?;
        Ok(())
    }
}

async fn validate_intent_scope(
    transaction: &DatabaseTransaction,
    intent: &LaunchIntent,
) -> Result<(), RunsPersistenceError> {
    let run = agent_run_entity::Entity::find_by_id(&intent.agent_run_id)
        .one(transaction)
        .await?;
    let Some(run) = run else {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::Conflict,
            "launch effect requires its predetermined Agent Run",
        ));
    };
    let project_id = work_item_scope::project_id(transaction, &run.issue_id).await?;
    if run.issue_id != intent.issue_id || project_id.as_deref() != Some(&intent.project_id) {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::Conflict,
            "launch effect scope does not match its predetermined Agent Run",
        ));
    }
    Ok(())
}

fn agent_run(row: agent_run_entity::Model) -> AgentRunRecord {
    AgentRunRecord {
        id: row.id,
        issue_id: row.issue_id,
        ticket_seq: row.ticket_seq,
        agent: row.agent,
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
    }
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

fn launch_effect(row: launch_effect_entity::Model) -> LaunchEffectRecord {
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
