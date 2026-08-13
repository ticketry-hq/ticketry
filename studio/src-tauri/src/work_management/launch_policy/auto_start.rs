use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use super::decisions::record_rejection;
use super::{
    record, CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest,
    LaunchPolicyResolver,
};
use crate::work_management::entities::{
    launch_policy_decision, launch_policy_rejection, transition_occurrence,
};

/// Resolve every new auto-start occurrence exactly once into a decision or a
/// durable actionable rejection. Django never sees an unresolved occurrence.
pub async fn prepare_pending_auto_starts(
    database: &DatabaseConnection,
    resolver: &LaunchPolicyResolver,
    limit: u64,
) -> Result<Vec<LaunchPolicyDecision>, LaunchPolicyError> {
    let occurrences = transition_occurrence::Entity::find()
        .filter(transition_occurrence::Column::DestinationAutoStart.eq(true))
        .filter(
            transition_occurrence::Column::OccurrenceId.not_in_subquery(
                launch_policy_decision::Entity::find()
                    .select_only()
                    .column(launch_policy_decision::Column::IdempotencyKey)
                    .filter(launch_policy_decision::Column::CallerScope.eq("auto_start"))
                    .into_query(),
            ),
        )
        .filter(
            transition_occurrence::Column::OccurrenceId.not_in_subquery(
                launch_policy_rejection::Entity::find()
                    .select_only()
                    .column(launch_policy_rejection::Column::IdempotencyKey)
                    .filter(launch_policy_rejection::Column::CallerScope.eq("auto_start"))
                    .into_query(),
            ),
        )
        .order_by_asc(transition_occurrence::Column::CommittedAt)
        .order_by_asc(transition_occurrence::Column::OccurrenceId)
        .limit(limit)
        .all(database)
        .await?;

    let mut decisions = Vec::new();
    for occurrence in occurrences {
        let request = LaunchPolicyRequest {
            task_id: occurrence.issue_id,
            destination_state_id: Some(occurrence.to_state_id),
            provider_override: None,
            caller_scope: CallerScope::AutoStart,
            idempotency_key: occurrence.occurrence_id,
        };
        match resolver.resolve(request.clone()).await {
            Ok(decision) => decisions.push(record(database, &decision).await?),
            Err(error) => {
                record_rejection(
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
