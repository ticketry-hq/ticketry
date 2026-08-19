use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use super::{
    record, rejections, CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest,
    LaunchPolicyResolver,
};
use crate::work_management::entities::{
    launch_policy_decision, launch_policy_rejection, transition_occurrence,
};

/// Resolve pending auto-start occurrences into decisions or into a rejection
/// explaining what still blocks them.
///
/// Two queues feed the resolver: occurrences nobody has judged yet, and
/// occurrences whose last rejection names a configuration state the user can
/// still repair. They are read separately so a long-standing misconfiguration
/// cannot crowd freshly committed transitions out of the pass budget.
pub async fn prepare_pending_auto_starts(
    database: &DatabaseConnection,
    resolver: &LaunchPolicyResolver,
    limit: u64,
) -> Result<Vec<LaunchPolicyDecision>, LaunchPolicyError> {
    let mut occurrences = unjudged(database, limit).await?;
    occurrences.extend(retryable(database, limit).await?);

    let mut decisions = Vec::new();
    for occurrence in occurrences {
        let request = LaunchPolicyRequest {
            task_id: occurrence.issue_id.clone(),
            destination_state_id: Some(occurrence.to_state_id),
            provider_override: None,
            caller_scope: CallerScope::AutoStart,
            idempotency_key: occurrence.occurrence_id,
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
                    "Ticketry rejected auto-start for work item {} ({disposition} {}): {error}",
                    occurrence.issue_id,
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

/// Auto-start occurrences with neither a decision nor a rejection.
async fn unjudged(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<transition_occurrence::Model>, LaunchPolicyError> {
    Ok(pending_query()
        .filter(
            transition_occurrence::Column::OccurrenceId.not_in_subquery(
                launch_policy_rejection::Entity::find()
                    .select_only()
                    .column(launch_policy_rejection::Column::IdempotencyKey)
                    .filter(
                        launch_policy_rejection::Column::CallerScope
                            .eq(CallerScope::AutoStart.as_str()),
                    )
                    .into_query(),
            ),
        )
        .order_by_asc(transition_occurrence::Column::CommittedAt)
        .order_by_asc(transition_occurrence::Column::OccurrenceId)
        .limit(limit)
        .all(database)
        .await?)
}

/// Auto-start occurrences whose last rejection was recoverable and has aged
/// past the retry backoff. A reactivated provider or a corrected profile
/// re-queues them here.
async fn retryable(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<transition_occurrence::Model>, LaunchPolicyError> {
    let keys = rejections::retryable_keys(database, CallerScope::AutoStart.as_str(), limit).await?;
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    Ok(pending_query()
        .filter(transition_occurrence::Column::OccurrenceId.is_in(keys))
        .order_by_asc(transition_occurrence::Column::CommittedAt)
        .order_by_asc(transition_occurrence::Column::OccurrenceId)
        .limit(limit)
        .all(database)
        .await?)
}

/// Auto-start occurrences that have not already produced a decision.
fn pending_query() -> sea_orm::Select<transition_occurrence::Entity> {
    transition_occurrence::Entity::find()
        .filter(transition_occurrence::Column::DestinationAutoStart.eq(true))
        .filter(
            transition_occurrence::Column::OccurrenceId.not_in_subquery(
                launch_policy_decision::Entity::find()
                    .select_only()
                    .column(launch_policy_decision::Column::IdempotencyKey)
                    .filter(
                        launch_policy_decision::Column::CallerScope
                            .eq(CallerScope::AutoStart.as_str()),
                    )
                    .into_query(),
            ),
        )
}
