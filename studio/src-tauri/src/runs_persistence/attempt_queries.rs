use std::collections::HashSet;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use super::entities::automation_attempt as automation_attempt_entity;
use super::repositories::automation_attempt;
use super::work_item_scope;
use super::{
    AttemptFailure, AutomationAttemptProjection, AutomationAttemptRecord, RunsPersistenceError,
    RunsPersistenceErrorCode,
};

pub async fn latest_attempts(
    database: &impl ConnectionTrait,
    project_id: &str,
    task_id: Option<&str>,
) -> Result<Vec<AutomationAttemptProjection>, RunsPersistenceError> {
    let project_id = database_uuid(project_id)?;
    let task_id = task_id.map(database_uuid).transpose()?;
    let issue_ids =
        work_item_scope::ids_for_project(database, &project_id, task_id.as_deref()).await?;
    let mut rows = automation_attempt_entity::Entity::find()
        .filter(automation_attempt_entity::Column::IssueId.is_in(issue_ids))
        .all(database)
        .await?;
    // Each lineage is represented by its newest attempt, and that attempt
    // alone decides whether the lineage is still visible. Filtering succeeded
    // or dismissed rows out of the candidate set first would resurface an
    // older unresolved outcome that its own lineage has already settled.
    rows.sort_by(|left, right| recency(right).cmp(&recency(left)));
    let mut resolved = HashSet::<String>::new();
    rows.into_iter()
        .filter(|attempt| resolved.insert(lineage(attempt)))
        .filter(|attempt| attempt.status != "succeeded" && attempt.dismissed_at.is_none())
        .map(automation_attempt)
        .map(project)
        .collect()
}

fn lineage(attempt: &automation_attempt_entity::Model) -> String {
    attempt
        .root_attempt_id
        .clone()
        .unwrap_or_else(|| attempt.id.clone())
}

fn recency(attempt: &automation_attempt_entity::Model) -> (&str, &str, &str) {
    (
        attempt.updated_at.as_str(),
        attempt.created_at.as_str(),
        attempt.id.as_str(),
    )
}

pub(crate) fn project(
    attempt: AutomationAttemptRecord,
) -> Result<AutomationAttemptProjection, RunsPersistenceError> {
    let root = attempt.root_attempt_id.as_deref().unwrap_or(&attempt.id);
    let failure = attempt
        .error_details
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("Automation Attempt failure details are not valid JSON"))?
        .map(AttemptFailure);
    Ok(AutomationAttemptProjection {
        attempt_id: public_uuid(&attempt.id),
        root_attempt_id: public_uuid(root),
        retry_of_attempt_id: attempt.retry_of_id.as_deref().map(public_uuid),
        work_item_id: public_uuid(&attempt.issue_id),
        // Retryability is a decision about a failure. The stored column keeps
        // the typed decision for a later restart, but only a failed attempt
        // publishes it — a pending or succeeded attempt is never retryable.
        retryable: attempt.status == "failed" && attempt.retryable,
        status: attempt.status,
        error: attempt.error,
        failure,
        agent_run_id: attempt.agent_run_id,
        updated_at: public_timestamp(&attempt.updated_at),
    })
}

pub(crate) fn database_uuid(value: &str) -> Result<String, RunsPersistenceError> {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .map_err(|_| invalid("Automation Attempt identifiers must be UUIDs"))
}

pub(crate) fn public_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn public_timestamp(value: &str) -> String {
    if value.contains('T') || value.ends_with('Z') {
        value.to_owned()
    } else {
        format!("{}Z", value.replacen(' ', "T", 1))
    }
}

fn invalid(message: &'static str) -> RunsPersistenceError {
    RunsPersistenceError::new(RunsPersistenceErrorCode::InvalidAttempt, message)
}
