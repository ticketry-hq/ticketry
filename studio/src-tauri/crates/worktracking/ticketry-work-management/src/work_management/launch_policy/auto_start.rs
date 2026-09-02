use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use super::{
    record, rejections, CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest,
    LaunchPolicyResolver,
};
use ticketry_entities::{launch_policy_decision, launch_policy_rejection, transition_occurrence};
use ticketry_runs::{RunsServices, TransitionOccurrence};

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
    occurrences.sort_by(|left, right| {
        (&left.committed_at, &left.occurrence_id).cmp(&(&right.committed_at, &right.occurrence_id))
    });
    occurrences.truncate(limit as usize);

    let mut decisions = Vec::new();
    let runs = RunsServices::new(database.clone());
    for occurrence in occurrences {
        // The attempt is the durable statement that this transition requested
        // automation. Create or adopt it before policy resolution so rejection,
        // restart, and later repair all converge on one root lineage.
        runs.attempts()
            .materialize_root(&TransitionOccurrence {
                occurrence_id: occurrence.occurrence_id.clone(),
                issue_id: occurrence.issue_id.clone(),
                project_id: occurrence.project_id.clone(),
                from_state_id: occurrence.from_state_id.clone(),
                to_state_id: occurrence.to_state_id.clone(),
                workflow_revision: occurrence.workflow_revision,
            })
            .await
            .map_err(|error| {
                LaunchPolicyError::rejected("launch_policy_storage_failed", error.to_string())
            })?;
        let request = LaunchPolicyRequest {
            task_id: occurrence.issue_id.clone(),
            destination_state_id: Some(occurrence.to_state_id),
            provider_override: None,
            caller_scope: CallerScope::AutoStart,
            idempotency_key: occurrence.occurrence_id,
            // The edge decided this at commit time. Reading it back from the
            // occurrence keeps delivery faithful to the workflow the mover
            // actually crossed, even if the edge is reconfigured afterwards.
            handoff: occurrence.handoff,
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
        .filter(transition_occurrence::Column::RunNowDecisionId.is_null())
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

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, Database};

    use super::*;
    use crate::work_management::open_for_commands;

    async fn occurrence(
        database: &DatabaseConnection,
        id: &str,
        run_now_decision_id: Option<&str>,
    ) {
        transition_occurrence::ActiveModel {
            occurrence_id: Set(id.to_owned()),
            version: Set(1),
            issue_id: Set(format!("issue-{id}")),
            project_id: Set("project".to_owned()),
            issue_type_id: Set("story".to_owned()),
            from_state_id: Set("ideas".to_owned()),
            to_state_id: Set("implement".to_owned()),
            from_group: Set("backlog".to_owned()),
            to_group: Set("started".to_owned()),
            work_item_revision: Set(2),
            workflow_revision: Set(3),
            destination_auto_start: Set(true),
            handoff: Set(false),
            run_now_decision_id: Set(run_now_decision_id.map(str::to_owned)),
            committed_at: sea_orm::ActiveValue::NotSet,
        }
        .insert(database)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn auto_start_skips_only_the_occurrence_claimed_by_run_now() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.db");
        Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .unwrap()
            .close()
            .await
            .unwrap();
        let database = open_for_commands(&path).await.unwrap();
        occurrence(&database, "claimed", Some("run-now-decision")).await;
        occurrence(&database, "ordinary", None).await;

        let pending = unjudged(&database, 10).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].occurrence_id, "ordinary");
    }
}
