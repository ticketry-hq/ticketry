use chrono::{DateTime, NaiveDateTime};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{json, Value};

use ticketry_entities::{agent_run, issue, transition_occurrence};

use super::RunPrincipal;

/// Preserve a committed handoff without coupling run cleanup to ticket progress.
///
/// A blocked agent may stop while its work item stays in its current state.
/// Termination never means the work was completed or cancelled. Only a queued
/// handoff keeps the same run alive to receive its destination prompt.
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
    None
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

fn unavailable(error: &str) -> Value {
    json!({"ok": false, "error": error})
}
