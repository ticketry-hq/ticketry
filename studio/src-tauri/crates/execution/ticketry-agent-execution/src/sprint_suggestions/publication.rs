use super::{
    output::{SuggestedStory, SuggestionOutput},
    snapshot::Snapshot,
    worker, SprintSuggestionExecutor,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, Set, TransactionTrait,
};
use ticketry_entities::{agent_execution, issue, sprint};
use ticketry_work_management::{record_in, RecordSprintSuggestion, SprintStorySuggestion};

pub(crate) async fn publish(
    service: &SprintSuggestionExecutor,
    job: &agent_execution::Model,
    snapshot: &Snapshot,
    output: SuggestionOutput,
) -> Result<(), String> {
    let txn = service.database.begin().await.map_err(|e| e.to_string())?;
    worker::lock(&txn, &job.id)
        .await
        .map_err(|e| e.to_string())?;
    let current = agent_execution::Entity::find_by_id(&job.id)
        .one(&txn)
        .await
        .map_err(|e| e.to_string())?
        .filter(|j| j.state == "running" && !j.cancel_requested)
        .ok_or("The execution is no longer running.")?;
    // Lock the sprint before comparing its run and goal revision.
    sprint::Entity::update_many()
        .col_expr(
            sprint::Column::Status,
            sea_orm::sea_query::Expr::col(sprint::Column::Status),
        )
        .filter(sprint::Column::Id.eq(&job.sprint_id))
        .exec(&txn)
        .await
        .map_err(|e| e.to_string())?;
    let sprint = sprint::Entity::find_by_id(&job.sprint_id)
        .one(&txn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Sprint not found.")?;
    if sprint.suggestion_run_id.as_deref() != Some(&job.agent_run_id)
        || sprint.status == "completed"
    {
        return Err("The suggestion run is no longer current.".into());
    }
    if sprint.goals_revised_at != snapshot.goals_revision {
        return Err("Goals changed while the agent was working. Run it again.".into());
    }
    for suggestion in output.suggestions {
        if !snapshot.goals.iter().any(|g| g.id == suggestion.goal_id) {
            return Err("The agent returned an unknown goal.".into());
        }
        let story = match suggestion.story {
            SuggestedStory::Existing { issue_id } => {
                if !snapshot.backlog.iter().any(|s| s.id == issue_id) {
                    return Err("The agent returned a story outside the backlog.".into());
                }
                let row = issue::Entity::find_by_id(&issue_id)
                    .one(&txn)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or("The suggested story no longer exists.")?;
                if row.sprint_id.is_some() {
                    return Err("A suggested story has already joined a sprint.".into());
                }
                SprintStorySuggestion::Existing { issue_id }
            }
            SuggestedStory::Proposed { name, epic_id } => {
                if !snapshot.epics.iter().any(|e| e.id == epic_id) {
                    return Err("The agent returned an unknown epic.".into());
                }
                SprintStorySuggestion::Proposal {
                    name,
                    epic_id: Some(epic_id),
                }
            }
        };
        record_in(
            &txn,
            &snapshot.project_id,
            &job.agent_run_id,
            RecordSprintSuggestion {
                sprint_id: job.sprint_id.clone(),
                goal_id: suggestion.goal_id,
                story,
                reason: suggestion.reason,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    let mut active = current.into_active_model();
    active.state = Set("succeeded".into());
    active.updated_at = Set(chrono::Utc::now().naive_utc());
    active.update(&txn).await.map_err(|e| e.to_string())?;
    worker::end_run(&txn, &job.agent_run_id, "succeeded", None)
        .await
        .map_err(|e| e.to_string())?;
    txn.commit().await.map_err(|e| e.to_string())
}
