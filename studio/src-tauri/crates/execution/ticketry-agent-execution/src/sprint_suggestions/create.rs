use super::snapshot;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait,
    IntoActiveModel, QueryFilter, Set,
};
use ticketry_entities::{agent_execution, agent_run, sprint, sprint_suggestion};

pub(crate) async fn prepare(
    txn: &DatabaseTransaction,
    project_id: &str,
    sprint_id: &str,
    request_id: &str,
) -> Result<agent_execution::ActiveModel, String> {
    let project_id = compact(project_id)?;
    let sprint_id = compact(sprint_id)?;
    let request_id = compact(request_id)?;
    sprint::Entity::update_many()
        .col_expr(sprint::Column::Status, Expr::col(sprint::Column::Status))
        .filter(sprint::Column::Id.eq(&sprint_id))
        .exec(txn)
        .await
        .map_err(|e| e.to_string())?;
    let sprint = sprint::Entity::find_by_id(&sprint_id)
        .one(txn)
        .await
        .map_err(|e| e.to_string())?
        .filter(|s| s.project_id == project_id)
        .ok_or("Sprint not found in this project.")?;
    if let Some(row) = agent_execution::Entity::find()
        .filter(agent_execution::Column::ClientRequestId.eq(&request_id))
        .one(txn)
        .await
        .map_err(|e| e.to_string())?
    {
        if row.sprint_id != sprint_id {
            return Err("The execution request belongs to another sprint.".into());
        }
        let mut active = row.clone().into_active_model();
        active.updated_at = Set(row.updated_at);
        return Ok(active);
    }
    if sprint.status == "completed" {
        return Err("A completed sprint cannot run a suggestion agent.".into());
    }
    if agent_execution::Entity::find()
        .filter(agent_execution::Column::SprintId.eq(&sprint_id))
        .filter(agent_execution::Column::State.is_in(["queued", "running"]))
        .one(txn)
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("An agent is already finding stories for this sprint.".into());
    }
    let snapshot = snapshot::capture(txn, &sprint).await?;
    snapshot.prompt()?;
    let run_id = uuid::Uuid::new_v4().simple().to_string();
    let now = chrono::Utc::now();
    agent_run::ActiveModel {
        id: Set(run_id.clone()),
        issue_id: Set(snapshot.module_id.clone()),
        ticket_seq: Set(None),
        agent: Set(Some(snapshot.provider.clone())),
        status: Set("running".into()),
        started_at: Set(now.to_rfc3339()),
        ended_at: Set(None),
        exit_code: Set(None),
        error: Set(None),
        cwd: Set(None),
        provider_session_id: Set(None),
        lifecycle_state: Set(Some("working".into())),
        lifecycle_updated_at: Set(Some(now.to_rfc3339())),
        design_dir: Set(None),
        resumed_from: Set(None),
        scope: Set("exec".into()),
        launch_state: Set(None),
        launch_model: Set(snapshot.model.clone()),
        initial_prompt: Set(None),
        launch_reasoning: Set(snapshot.reasoning.clone()),
        launch_unattended: Set(false),
        attention_reason: Set(None),
        ..Default::default()
    }
    .insert(txn)
    .await
    .map_err(|e| e.to_string())?;
    for restricted_run in sprint
        .suggestion_run_id
        .iter()
        .chain(std::iter::once(&run_id))
    {
        ticketry_runs::restrict_sprint_suggestion_run_in(txn, restricted_run)
            .await
            .map_err(|e| e.to_string())?;
    }
    sprint_suggestion::Entity::delete_many()
        .filter(sprint_suggestion::Column::SprintId.eq(&sprint_id))
        .filter(sprint_suggestion::Column::Status.eq("waiting"))
        .exec(txn)
        .await
        .map_err(|e| e.to_string())?;
    let mut active = sprint.into_active_model();
    active.suggestion_run_id = Set(Some(run_id.clone()));
    active.update(txn).await.map_err(|e| e.to_string())?;
    Ok(agent_execution::ActiveModel {
        id: Set(run_id.clone()),
        agent_run_id: Set(run_id),
        client_request_id: Set(request_id),
        sprint_id: Set(sprint_id),
        output_type: Set("sprint_suggestions_v1".into()),
        input_snapshot: Set(serde_json::to_string(&snapshot).map_err(|e| e.to_string())?),
        goals_revision: Set(snapshot.goals_revision),
        state: Set("queued".into()),
        error: Set(None),
        cancel_requested: Set(false),
        created_at: Set(now.naive_utc()),
        updated_at: Set(now.naive_utc()),
        ..Default::default()
    })
}
pub(crate) fn compact(id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(id)
        .map(|id| id.simple().to_string())
        .map_err(|_| "Enter a valid identity.".into())
}
