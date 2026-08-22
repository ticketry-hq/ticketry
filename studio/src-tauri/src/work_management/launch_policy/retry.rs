//! Resolving explicitly requested Automation Attempt retries into launches.
//!
//! The retry command appends a durable pending child and nothing else: it owns
//! the retry lineage, not the launch. Turning that child into a running agent
//! is a launch-policy decision like any other, so it is resolved here from the
//! same durable ledger the auto-start pass uses. That is what makes the button
//! survive a crash — the child stays pending until a decision is recorded and
//! performed, and is never launched twice because the attempt itself is the
//! idempotency key.

use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use super::{
    record, rejections, CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest,
    LaunchPolicyResolver,
};
use crate::entities::runs::automation_attempt;
use crate::work_management::entities::{launch_policy_decision, launch_policy_rejection};

pub async fn prepare_pending_retries(
    database: &DatabaseConnection,
    resolver: &LaunchPolicyResolver,
    limit: u64,
) -> Result<Vec<LaunchPolicyDecision>, LaunchPolicyError> {
    let mut attempts = unjudged(database, limit).await?;
    attempts.extend(retryable(database, limit).await?);
    attempts
        .sort_by(|left, right| (&left.created_at, &left.id).cmp(&(&right.created_at, &right.id)));
    attempts.truncate(limit as usize);

    let mut decisions = Vec::new();
    for attempt in attempts {
        let request = LaunchPolicyRequest {
            task_id: attempt.issue_id.clone(),
            destination_state_id: Some(attempt.to_state_id),
            provider_override: None,
            caller_scope: CallerScope::Retry,
            idempotency_key: attempt.id,
        };
        match resolver.resolve(request.clone()).await {
            Ok(decision) => {
                decisions.push(record(database, &decision).await?);
                rejections::clear(
                    database,
                    request.caller_scope.as_str(),
                    &request.idempotency_key,
                )
                .await?;
            }
            Err(error) => {
                let disposition = if rejections::is_recoverable(error.code()) {
                    "recoverable"
                } else {
                    "terminal"
                };
                eprintln!(
                    "Ticketry rejected the retry launch for work item {} ({disposition} {}): {error}",
                    attempt.issue_id,
                    error.code(),
                );
                rejections::record(
                    database,
                    request.caller_scope.as_str(),
                    &request.idempotency_key,
                    &error,
                )
                .await?;
            }
        }
    }
    Ok(decisions)
}

/// Pending retry children with neither a decision nor a rejection.
async fn unjudged(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<automation_attempt::Model>, LaunchPolicyError> {
    Ok(pending_query()
        .filter(
            automation_attempt::Column::Id.not_in_subquery(
                launch_policy_rejection::Entity::find()
                    .select_only()
                    .column(launch_policy_rejection::Column::IdempotencyKey)
                    .filter(
                        launch_policy_rejection::Column::CallerScope
                            .eq(CallerScope::Retry.as_str()),
                    )
                    .into_query(),
            ),
        )
        .order_by_asc(automation_attempt::Column::CreatedAt)
        .order_by_asc(automation_attempt::Column::Id)
        .limit(limit)
        .all(database)
        .await?)
}

/// Pending retry children whose last rejection was recoverable and has aged
/// past the backoff: repairing the configuration re-queues the retry the user
/// already asked for rather than making them press the button again.
async fn retryable(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<automation_attempt::Model>, LaunchPolicyError> {
    let keys = rejections::retryable_keys(database, CallerScope::Retry.as_str(), limit).await?;
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    Ok(pending_query()
        .filter(automation_attempt::Column::Id.is_in(keys))
        .order_by_asc(automation_attempt::Column::CreatedAt)
        .order_by_asc(automation_attempt::Column::Id)
        .limit(limit)
        .all(database)
        .await?)
}

/// Retry children still awaiting a launch: pending, undismissed, and without a
/// decision already recorded against them.
fn pending_query() -> sea_orm::Select<automation_attempt::Entity> {
    automation_attempt::Entity::find()
        .filter(automation_attempt::Column::RetryOfId.is_not_null())
        .filter(automation_attempt::Column::Status.eq("pending"))
        .filter(automation_attempt::Column::DismissedAt.is_null())
        .filter(
            automation_attempt::Column::Id.not_in_subquery(
                launch_policy_decision::Entity::find()
                    .select_only()
                    .column(launch_policy_decision::Column::IdempotencyKey)
                    .filter(
                        launch_policy_decision::Column::CallerScope.eq(CallerScope::Retry.as_str()),
                    )
                    .into_query(),
            ),
        )
}
