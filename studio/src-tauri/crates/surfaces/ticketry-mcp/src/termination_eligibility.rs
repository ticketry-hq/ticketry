use chrono::{DateTime, NaiveDateTime};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{json, Value};

use ticketry_entities::{agent_run, issue, issue_type_transition, state, transition_occurrence};

use super::RunPrincipal;

/// Decide whether a ticket run may end itself yet.
///
/// The gate only ever rejects a request the caller can actually satisfy. When
/// the launch state is unrecorded, no longer exists, or has no configured
/// outgoing transition, there is no destination to ask for, so refusing would
/// strand the run forever; those cases pass. Every real rejection names the
/// destination states that would let the retry succeed.
pub(super) async fn rejection(
    database: &sea_orm::DatabaseConnection,
    principal: &RunPrincipal,
) -> Option<Value> {
    if !matches!(principal.scope.as_str(), "task" | "automation") {
        return None;
    }
    let run = match agent_run::Entity::find_by_id(&principal.agent_run_id)
        .one(database)
        .await
    {
        Ok(Some(run)) => run,
        Ok(None) => return Some(unavailable("caller_run_unknown")),
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    let item = match issue::Entity::find_by_id(&run.issue_id).one(database).await {
        Ok(Some(item)) => item,
        Ok(None) => return Some(unavailable("caller_run_unknown")),
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    let launch_state_name = run.launch_state.as_deref()?;
    let launch = match state::Entity::find()
        .filter(state::Column::ProjectId.eq(&item.project_id))
        .filter(state::Column::Name.eq(launch_state_name))
        .one(database)
        .await
    {
        Ok(Some(launch)) => launch,
        Ok(None) => return None,
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    let destinations = match issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&item.issue_type_id))
        .filter(issue_type_transition::Column::FromStateId.eq(&launch.id))
        .all(database)
        .await
    {
        Ok(destinations) => destinations,
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    if destinations.is_empty() {
        return None;
    }
    let destination_ids: Vec<String> = destinations
        .into_iter()
        .map(|transition| transition.to_state_id)
        .collect();
    let current_id = item.state_id.as_deref();
    if let (Some(current), Some(started_at)) = (current_id, parse_timestamp(&run.started_at)) {
        let latest = transition_occurrence::Entity::find()
            .filter(transition_occurrence::Column::IssueId.eq(&run.issue_id))
            .filter(transition_occurrence::Column::CommittedAt.gte(started_at))
            .order_by_desc(transition_occurrence::Column::CommittedAt)
            .order_by_desc(transition_occurrence::Column::OccurrenceId)
            .one(database)
            .await;
        match latest {
            Ok(Some(transition)) if transition.to_state_id == current => {
                return transition
                    .handoff
                    .then(|| handoff_continues(&principal.agent_run_id));
            }
            Ok(_) => {}
            Err(_) => return Some(unavailable("terminate_failed")),
        }
    }
    if current_id.is_some_and(|current| destination_ids.iter().any(|id| id == current)) {
        return None;
    }
    let allowed = match state::Entity::find()
        .filter(state::Column::Id.is_in(destination_ids))
        .order_by_asc(state::Column::SortOrder)
        .all(database)
        .await
    {
        Ok(allowed) => allowed,
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    let current_name = match current_id {
        Some(id) => match state::Entity::find_by_id(id).one(database).await {
            Ok(current) => current.map(|current| current.name),
            Err(_) => return Some(unavailable("terminate_failed")),
        },
        None => None,
    };
    Some(transition_required(
        launch_state_name,
        current_name.as_deref(),
        allowed.into_iter().map(|state| state.name).collect(),
    ))
}

fn parse_timestamp(value: &str) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.naive_utc())
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f").ok())
}

fn handoff_continues(agent_run_id: &str) -> Value {
    json!({
        "ok": true,
        "termination_requested": false,
        "terminated": false,
        "already_terminated": false,
        "continued_by_handoff": true,
        "agent_run_id": agent_run_id,
    })
}

fn transition_required(
    launch_state: &str,
    current_state: Option<&str>,
    allowed_states: Vec<String>,
) -> Value {
    json!({
        "ok": false,
        "error": "ticket_transition_required",
        "launch_state": launch_state,
        "current_state": current_state,
        "allowed_states": allowed_states,
        "detail": format!(
            "Move task to one of these states with update_task_status, then call \
             terminate_current_run again: {}.",
            allowed_states.join(", ")
        ),
    })
}

fn unavailable(error: &str) -> Value {
    json!({"ok": false, "error": error})
}
