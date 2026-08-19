//! Atomic preparation of one durable launch.
//!
//! Nothing outside this transaction may exist before it commits: the
//! predetermined Agent Run, the immutable Launch Effect, the run's initial
//! lifecycle fact, and its status event appear together or not at all. Only a
//! committed effect may wake an executor.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, ColumnTrait, Condition,
    DatabaseTransaction, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::json;

use super::entities::{agent_run as agent_run_entity, launch_effect as launch_effect_entity};
use super::repositories::launch_effect;
use super::{
    timestamp, work_item_scope, EffectService, LaunchEffectRecord, LaunchIntent, NewStatusEvent,
    RunsPersistenceError, RunsPersistenceErrorCode,
};

/// The complete input to a launch.
///
/// Everything outside `intent` is launch-time run snapshot: the resolved
/// provider settings, the directory the run was rooted in, the design
/// directory its documents land in, and the resume lineage. None of it takes
/// part in idempotent reuse, and none of it is reconcilable launch intent — a
/// crash recovers the launch from `intent` alone. It is recorded because the
/// Agent Run has always carried it and Studio still reads it.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RunSnapshot {
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub cwd: Option<String>,
    pub design_dir: Option<String>,
    pub resumed_from: Option<String>,
    pub provider_session_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrepareLaunchRequest {
    pub intent: LaunchIntent,
    pub snapshot: RunSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedLaunch {
    pub effect: LaunchEffectRecord,
    /// True when an identical launch identity was already durable. A repeated
    /// transport request reuses its effect instead of minting a second one.
    pub reused: bool,
    pub event_cursor: Option<i64>,
}

impl EffectService {
    pub async fn prepare_launch(
        &self,
        request: PrepareLaunchRequest,
    ) -> Result<PreparedLaunch, RunsPersistenceError> {
        let intent = normalize(request.intent.clone())?;
        let transaction = self.database().begin().await?;
        validate_work_item_scope(&transaction, &intent).await?;

        if let Some(existing) = launch_effect_entity::Entity::find_by_id(&intent.effect_id)
            .one(&transaction)
            .await?
            .map(launch_effect)
        {
            validate_reuse(&existing, &intent)?;
            transaction.commit().await?;
            return Ok(PreparedLaunch {
                effect: existing,
                reused: true,
                event_cursor: None,
            });
        }
        validate_identities_unclaimed(&transaction, &intent).await?;

        let started_at = timestamp::format(Utc::now());
        mint_or_validate_run(&transaction, &intent, &request, &started_at).await?;
        let effect = launch_effect_entity::ActiveModel {
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
        .insert(&transaction)
        .await
        .map_err(|_| conflict("The launch identity is already durable."))?;

        let event_id = uuid::Uuid::new_v4().simple().to_string();
        let payload = json!({
            "agentRunId": intent.agent_run_id,
            "state": "starting",
            "occurredAt": started_at,
            "providerSessionCaptured": false,
        });
        let cursor = self
            .events()
            .append(
                &transaction,
                NewStatusEvent {
                    event_id: &event_id,
                    project_id: &intent.project_id,
                    event_kind: "agent_run.lifecycle",
                    payload_version: 1,
                    subject_kind: "agent_run",
                    subject_id: &intent.agent_run_id,
                    agent_run_id: Some(&intent.agent_run_id),
                    automation_attempt_id: intent.automation_attempt_id.as_deref(),
                    work_item_id: Some(&intent.issue_id),
                    payload: &payload,
                },
            )
            .await?;
        transaction.commit().await?;
        self.events().wake_committed();
        Ok(PreparedLaunch {
            effect: launch_effect(effect),
            reused: false,
            event_cursor: Some(cursor),
        })
    }
}

/// Launch identities reach Rust in either UUID spelling. The database stores
/// the unhyphenated form, so normalization happens once, here, before any
/// comparison decides idempotency.
fn normalize(mut intent: LaunchIntent) -> Result<LaunchIntent, RunsPersistenceError> {
    intent.validate()?;
    intent.effect_id = database_uuid(&intent.effect_id);
    intent.project_id = database_uuid(&intent.project_id);
    intent.issue_id = database_uuid(&intent.issue_id);
    intent.automation_attempt_id = intent
        .automation_attempt_id
        .as_deref()
        .map(database_uuid)
        .filter(|value| !value.is_empty());
    if intent.target_kind == "task" || intent.target_kind == "work_item" {
        intent.target_id = database_uuid(&intent.target_id);
    }
    Ok(intent)
}

async fn validate_work_item_scope(
    transaction: &DatabaseTransaction,
    intent: &LaunchIntent,
) -> Result<(), RunsPersistenceError> {
    let scope = work_item_scope::automation_scope(transaction, &intent.issue_id)
        .await?
        .ok_or_else(|| conflict("The launch intent references no WorkItem."))?;
    if scope.project_id != intent.project_id {
        return Err(conflict(
            "The launch intent project does not own its WorkItem.",
        ));
    }
    Ok(())
}

/// Reuse is idempotent only when every identity field matches. Target, scope,
/// provider/policy, attempt, request, effect, and run identity are all part of
/// that decision; anything else is a caller mistake, not a retry.
fn validate_reuse(
    existing: &LaunchEffectRecord,
    intent: &LaunchIntent,
) -> Result<(), RunsPersistenceError> {
    let matches = existing.agent_run_id == intent.agent_run_id
        && existing.automation_attempt_id == intent.automation_attempt_id
        && existing.request_id == intent.request_id
        && existing.project_id == intent.project_id
        && existing.issue_id == intent.issue_id
        && existing.scope == intent.scope
        && existing.provider == intent.provider
        && existing.target_kind == intent.target_kind
        && existing.target_id == intent.target_id
        && existing.policy_reference == intent.policy_reference;
    if matches {
        return Ok(());
    }
    Err(conflict(
        "The launch identity is already bound to a different launch.",
    ))
}

/// An Automation Attempt owns at most one Launch Effect and one Agent Run, and
/// one transport request owns at most one effect. Reporting these as typed
/// conflicts keeps a caller mistake from surfacing as a storage failure.
async fn validate_identities_unclaimed(
    transaction: &DatabaseTransaction,
    intent: &LaunchIntent,
) -> Result<(), RunsPersistenceError> {
    let mut condition = Condition::any()
        .add(launch_effect_entity::Column::AgentRunId.eq(&intent.agent_run_id))
        .add(launch_effect_entity::Column::RequestId.eq(&intent.request_id));
    if let Some(attempt_id) = intent.automation_attempt_id.as_deref() {
        condition = condition.add(launch_effect_entity::Column::AutomationAttemptId.eq(attempt_id));
    }
    let claimed = launch_effect_entity::Entity::find()
        .filter(condition)
        .one(transaction)
        .await?;
    let Some(claimed) = claimed else {
        return Ok(());
    };
    Err(conflict(if claimed.agent_run_id == intent.agent_run_id {
        "The Agent Run identity already owns a Launch Effect."
    } else if claimed.request_id == intent.request_id {
        "The launch request identity already owns a Launch Effect."
    } else {
        "The Automation Attempt already owns a Launch Effect."
    }))
}

/// Mint the predetermined Agent Run, or validate an existing one. A launch
/// never adopts a run that belongs to different work or has already ended.
async fn mint_or_validate_run(
    transaction: &DatabaseTransaction,
    intent: &LaunchIntent,
    request: &PrepareLaunchRequest,
    started_at: &str,
) -> Result<(), RunsPersistenceError> {
    if let Some(run) = agent_run_entity::Entity::find_by_id(&intent.agent_run_id)
        .one(transaction)
        .await?
    {
        if run.issue_id != intent.issue_id
            || run.agent != intent.provider
            || run.scope != intent.scope
        {
            return Err(conflict(
                "The predetermined Agent Run belongs to a different launch.",
            ));
        }
        if run.ended_at.is_some() {
            return Err(conflict("The predetermined Agent Run has already ended."));
        }
        return Ok(());
    }
    agent_run_entity::ActiveModel {
        id: Set(intent.agent_run_id.clone()),
        issue_id: Set(intent.issue_id.clone()),
        ticket_seq: NotSet,
        agent: Set(intent.provider.clone()),
        model: Set(request.snapshot.model.clone()),
        reasoning: Set(request.snapshot.reasoning.clone()),
        status: Set("running".to_owned()),
        started_at: Set(started_at.to_owned()),
        ended_at: NotSet,
        exit_code: NotSet,
        error: NotSet,
        cwd: Set(request.snapshot.cwd.clone()),
        provider_session_id: Set(request.snapshot.provider_session_id.clone()),
        lifecycle_state: Set(Some("starting".to_owned())),
        lifecycle_updated_at: Set(Some(started_at.to_owned())),
        design_dir: Set(request.snapshot.design_dir.clone()),
        resumed_from: Set(request.snapshot.resumed_from.clone()),
        scope: Set(intent.scope.clone()),
    }
    .insert(transaction)
    .await
    .map_err(|_| conflict("The predetermined Agent Run identity is already durable."))?;
    Ok(())
}

fn database_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn conflict(message: &'static str) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::LaunchConflict, message)
}
