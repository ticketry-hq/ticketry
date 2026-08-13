use sea_orm::{
    sea_query::{Expr, OnConflict},
    ActiveValue::NotSet,
    ActiveValue::Set,
    ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait, QueryFilter,
    TransactionTrait,
};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use super::attempt_queries::{database_uuid, project};
use super::entities::automation_attempt as automation_attempt_entity;
use super::repositories::{automation_attempt, NewStatusEvent};
use super::work_item_scope;
use super::{
    AttemptOutcome, AutomationAttemptProjection, AutomationAttemptRecord, RunsPersistenceError,
    RunsPersistenceErrorCode, StatusEventRepository, TransitionOccurrence,
};

pub async fn materialize_root(
    database: &DatabaseConnection,
    events: &StatusEventRepository,
    occurrence: &TransitionOccurrence,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    let occurrence_id = database_uuid(&occurrence.occurrence_id)?;
    let issue_id = database_uuid(&occurrence.issue_id)?;
    let project_id = database_uuid(&occurrence.project_id)?;
    let from_state_id = database_uuid(&occurrence.from_state_id)?;
    let to_state_id = database_uuid(&occurrence.to_state_id)?;
    if occurrence.workflow_revision < 0 {
        return Err(invalid(
            "Automation Attempt workflow revision cannot be negative",
        ));
    }

    let transaction = database.begin().await?;
    validate_issue_scope(&transaction, &issue_id, &project_id).await?;
    let attempt_id = uuid::Uuid::new_v4().simple().to_string();
    let timestamp = now();
    let inserted =
        automation_attempt_entity::Entity::insert(automation_attempt_entity::ActiveModel {
            id: Set(attempt_id),
            transition_id: Set(occurrence_id.clone()),
            issue_id: Set(issue_id.clone()),
            from_state_id: Set(from_state_id.clone()),
            to_state_id: Set(to_state_id.clone()),
            workflow_revision: Set(occurrence.workflow_revision),
            status: Set("pending".to_owned()),
            agent: NotSet,
            agent_run_id: NotSet,
            error: NotSet,
            error_details: NotSet,
            retryable: Set(true),
            dismissed_at: NotSet,
            retry_of_id: NotSet,
            root_attempt_id: NotSet,
            created_at: Set(timestamp.clone()),
            updated_at: Set(timestamp),
        })
        .on_conflict(OnConflict::new().do_nothing().to_owned())
        .exec_without_returning(&transaction)
        .await?
            == 1;
    let attempt = attempt_by_occurrence(&transaction, &occurrence_id).await?;
    validate_occurrence(
        &attempt,
        &issue_id,
        &from_state_id,
        &to_state_id,
        occurrence.workflow_revision,
    )?;
    if inserted {
        append_attempt_event(
            events,
            &transaction,
            &project_id,
            "automation_attempt_created",
            &attempt,
        )
        .await?;
    }
    transaction.commit().await?;
    project(attempt)
}

pub async fn record_outcome(
    database: &DatabaseConnection,
    events: &StatusEventRepository,
    attempt_id: &str,
    outcome: AttemptOutcome,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    validate_outcome(&outcome)?;
    let attempt_id = database_uuid(attempt_id)?;
    let transaction = database.begin().await?;
    let (current, project_id) = attempt_with_project(&transaction, &attempt_id).await?;
    let desired_status = match &outcome {
        AttemptOutcome::Succeeded { .. } => "succeeded",
        AttemptOutcome::Failed { .. } => "failed",
    };
    if current.status != "pending" {
        if current.status == desired_status {
            transaction.commit().await?;
            return project(current);
        }
        return Err(conflict("Automation Attempt outcome is already final"));
    }

    let result = match outcome {
        AttemptOutcome::Succeeded {
            agent,
            agent_run_id,
        } => {
            let timestamp = now();
            automation_attempt_entity::Entity::update_many()
                .col_expr(
                    automation_attempt_entity::Column::Status,
                    Expr::value("succeeded"),
                )
                .col_expr(automation_attempt_entity::Column::Agent, Expr::value(agent))
                .col_expr(
                    automation_attempt_entity::Column::AgentRunId,
                    Expr::value(agent_run_id),
                )
                .col_expr(
                    automation_attempt_entity::Column::Error,
                    Expr::value(None::<String>),
                )
                .col_expr(
                    automation_attempt_entity::Column::ErrorDetails,
                    Expr::value(None::<String>),
                )
                .col_expr(
                    automation_attempt_entity::Column::Retryable,
                    Expr::value(false),
                )
                .col_expr(
                    automation_attempt_entity::Column::UpdatedAt,
                    Expr::value(timestamp),
                )
                .filter(automation_attempt_entity::Column::Id.eq(&attempt_id))
                .filter(automation_attempt_entity::Column::Status.eq("pending"))
                .exec(&transaction)
                .await?
        }
        AttemptOutcome::Failed {
            error,
            failure,
            retryable,
        } => {
            let timestamp = now();
            automation_attempt_entity::Entity::update_many()
                .col_expr(
                    automation_attempt_entity::Column::Status,
                    Expr::value("failed"),
                )
                .col_expr(automation_attempt_entity::Column::Error, Expr::value(error))
                .col_expr(
                    automation_attempt_entity::Column::ErrorDetails,
                    Expr::value(failure.to_string()),
                )
                .col_expr(
                    automation_attempt_entity::Column::Retryable,
                    Expr::value(retryable),
                )
                .col_expr(
                    automation_attempt_entity::Column::UpdatedAt,
                    Expr::value(timestamp),
                )
                .filter(automation_attempt_entity::Column::Id.eq(&attempt_id))
                .filter(automation_attempt_entity::Column::Status.eq("pending"))
                .exec(&transaction)
                .await?
        }
    };
    if result.rows_affected == 0 {
        let (winner, _) = attempt_with_project(&transaction, &attempt_id).await?;
        if winner.status == desired_status {
            transaction.commit().await?;
            return project(winner);
        }
        return Err(conflict("Automation Attempt outcome is already final"));
    }
    let (attempt, _) = attempt_with_project(&transaction, &attempt_id).await?;
    append_attempt_event(
        events,
        &transaction,
        &project_id,
        "automation_attempt_outcome",
        &attempt,
    )
    .await?;
    transaction.commit().await?;
    project(attempt)
}

pub async fn dismiss(
    database: &DatabaseConnection,
    events: &StatusEventRepository,
    attempt_id: &str,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    let attempt_id = database_uuid(attempt_id)?;
    let transaction = database.begin().await?;
    let (current, project_id) = attempt_with_project(&transaction, &attempt_id).await?;
    if current.status != "failed" {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::AttemptNotFailed,
            "Only failed Automation Attempts can be dismissed",
        ));
    }
    if current.dismissed_at.is_some() {
        transaction.commit().await?;
        return project(current);
    }
    let changed_at = now();
    let changed = automation_attempt_entity::Entity::update_many()
        .col_expr(
            automation_attempt_entity::Column::DismissedAt,
            Expr::value(changed_at.clone()),
        )
        .col_expr(
            automation_attempt_entity::Column::UpdatedAt,
            Expr::value(changed_at),
        )
        .filter(automation_attempt_entity::Column::Id.eq(&attempt_id))
        .filter(automation_attempt_entity::Column::Status.eq("failed"))
        .filter(automation_attempt_entity::Column::DismissedAt.is_null())
        .exec(&transaction)
        .await?
        .rows_affected
        == 1;
    let (attempt, _) = attempt_with_project(&transaction, &attempt_id).await?;
    if changed {
        append_attempt_event(
            events,
            &transaction,
            &project_id,
            "automation_attempt_dismissed",
            &attempt,
        )
        .await?;
    }
    transaction.commit().await?;
    project(attempt)
}

pub async fn retry(
    database: &DatabaseConnection,
    events: &StatusEventRepository,
    source_id: &str,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    let source_id = database_uuid(source_id)?;
    let transaction = database.begin().await?;
    let (source, project_id) = attempt_with_project(&transaction, &source_id).await?;
    if let Some(existing) = retry_child(&transaction, &source_id).await? {
        transaction.commit().await?;
        return project(existing);
    }
    if source.status != "failed" {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::AttemptNotFailed,
            "Automation Attempt is not failed",
        ));
    }
    if !source.retryable {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::AttemptNotRetryable,
            "Automation Attempt is not retryable",
        ));
    }
    let retry_id = uuid::Uuid::new_v4().simple().to_string();
    let root_id = source
        .root_attempt_id
        .clone()
        .unwrap_or_else(|| source.id.clone());
    let timestamp = now();
    let inserted =
        automation_attempt_entity::Entity::insert(automation_attempt_entity::ActiveModel {
            id: Set(retry_id),
            transition_id: Set(source.transition_id.clone()),
            issue_id: Set(source.issue_id.clone()),
            from_state_id: Set(source.from_state_id.clone()),
            to_state_id: Set(source.to_state_id.clone()),
            workflow_revision: Set(source.workflow_revision),
            status: Set("pending".to_owned()),
            agent: NotSet,
            agent_run_id: NotSet,
            error: NotSet,
            error_details: NotSet,
            retryable: Set(true),
            dismissed_at: NotSet,
            retry_of_id: Set(Some(source.id.clone())),
            root_attempt_id: Set(Some(root_id)),
            created_at: Set(timestamp.clone()),
            updated_at: Set(timestamp),
        })
        .on_conflict(OnConflict::new().do_nothing().to_owned())
        .exec_without_returning(&transaction)
        .await?
            == 1;
    let retry = retry_child(&transaction, &source_id)
        .await?
        .ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::Storage,
                "Automation Attempt retry was not found after insertion",
            )
        })?;
    if inserted {
        append_attempt_event(
            events,
            &transaction,
            &project_id,
            "automation_attempt_retried",
            &retry,
        )
        .await?;
    }
    transaction.commit().await?;
    project(retry)
}

async fn validate_issue_scope(
    transaction: &DatabaseTransaction,
    issue_id: &str,
    project_id: &str,
) -> Result<(), RunsPersistenceError> {
    let row = work_item_scope::automation_scope(transaction, issue_id)
        .await?
        .ok_or_else(|| invalid("Transition occurrence references no WorkItem"))?;
    if row.project_id != project_id || row.issue_type != "task" {
        return Err(conflict(
            "Transition occurrence scope does not match its WorkItem",
        ));
    }
    Ok(())
}

fn validate_occurrence(
    attempt: &AutomationAttemptRecord,
    issue_id: &str,
    from_state_id: &str,
    to_state_id: &str,
    workflow_revision: i32,
) -> Result<(), RunsPersistenceError> {
    if attempt.retry_of_id.is_some()
        || attempt.issue_id != issue_id
        || attempt.from_state_id != from_state_id
        || attempt.to_state_id != to_state_id
        || attempt.workflow_revision != workflow_revision
    {
        return Err(conflict(
            "Transition occurrence conflicts with its existing root Automation Attempt",
        ));
    }
    Ok(())
}

fn validate_outcome(outcome: &AttemptOutcome) -> Result<(), RunsPersistenceError> {
    match outcome {
        AttemptOutcome::Succeeded {
            agent,
            agent_run_id,
        } if agent.trim().is_empty() || agent_run_id.trim().is_empty() => Err(invalid(
            "Successful Automation Attempts require agent and Agent Run identities",
        )),
        AttemptOutcome::Failed { error, failure, .. }
            if error.trim().is_empty()
                || !failure.is_object()
                || failure.get("code").and_then(Value::as_str).is_none() =>
        {
            Err(invalid(
                "Failed Automation Attempts require an error and typed failure object",
            ))
        }
        _ => Ok(()),
    }
}

async fn attempt_by_occurrence(
    transaction: &DatabaseTransaction,
    occurrence_id: &str,
) -> Result<AutomationAttemptRecord, RunsPersistenceError> {
    let row = automation_attempt_entity::Entity::find()
        .filter(automation_attempt_entity::Column::TransitionId.eq(occurrence_id))
        .filter(automation_attempt_entity::Column::RetryOfId.is_null())
        .one(transaction)
        .await?
        .ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::Storage,
                "Root Automation Attempt was not found after insertion",
            )
        })?;
    Ok(automation_attempt(row))
}

async fn attempt_with_project(
    transaction: &DatabaseTransaction,
    attempt_id: &str,
) -> Result<(AutomationAttemptRecord, String), RunsPersistenceError> {
    let attempt = automation_attempt_entity::Entity::find_by_id(attempt_id)
        .one(transaction)
        .await?
        .ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::AttemptNotFound,
                "Automation Attempt was not found",
            )
        })?;
    let project_id = work_item_scope::project_id(transaction, &attempt.issue_id)
        .await?
        .ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidHistory,
                "Automation Attempt references no WorkItem",
            )
        })?;
    Ok((automation_attempt(attempt), project_id))
}

async fn retry_child(
    transaction: &DatabaseTransaction,
    source_id: &str,
) -> Result<Option<AutomationAttemptRecord>, RunsPersistenceError> {
    Ok(automation_attempt_entity::Entity::find()
        .filter(automation_attempt_entity::Column::RetryOfId.eq(source_id))
        .one(transaction)
        .await?
        .map(automation_attempt))
}

async fn append_attempt_event(
    events: &StatusEventRepository,
    transaction: &DatabaseTransaction,
    project_id: &str,
    event_kind: &str,
    attempt: &AutomationAttemptRecord,
) -> Result<(), RunsPersistenceError> {
    let projection = project(attempt.clone())?;
    let payload = serde_json::to_value(&projection).unwrap_or_else(|_| json!({}));
    let event_id = uuid::Uuid::new_v4().simple().to_string();
    events
        .append(
            transaction,
            NewStatusEvent {
                event_id: &event_id,
                project_id,
                event_kind,
                payload_version: 1,
                subject_kind: "automation_attempt",
                subject_id: &attempt.id,
                agent_run_id: attempt.agent_run_id.as_deref(),
                automation_attempt_id: Some(&attempt.id),
                work_item_id: Some(&attempt.issue_id),
                payload: &payload,
            },
        )
        .await?;
    Ok(())
}

fn invalid(message: &'static str) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::InvalidAttempt, message)
}

fn conflict(message: &'static str) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::Conflict, message)
}

fn now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock predates the Unix epoch");
    sea_orm::prelude::DateTimeUtc::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("the system clock is outside SQLite's datetime range")
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S%.f")
        .to_string()
}
