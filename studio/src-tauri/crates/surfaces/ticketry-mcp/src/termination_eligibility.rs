use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{json, Value};

use ticketry_entities::{agent_run, issue, issue_type_transition, state};

use super::RunPrincipal;

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
    let current = match item.state_id.as_deref() {
        Some(id) => match state::Entity::find_by_id(id).one(database).await {
            Ok(Some(current)) => current,
            Ok(None) => return Some(unavailable("ticket_transition_required")),
            Err(_) => return Some(unavailable("terminate_failed")),
        },
        None => return Some(unavailable("ticket_transition_required")),
    };
    let Some(launch_state_name) = run.launch_state.as_deref() else {
        return Some(transition_required(None, Some(&current.name)));
    };
    let launch = match state::Entity::find()
        .filter(state::Column::ProjectId.eq(&item.project_id))
        .filter(state::Column::Name.eq(launch_state_name))
        .one(database)
        .await
    {
        Ok(Some(launch)) => launch,
        Ok(None) => {
            return Some(transition_required(
                Some(launch_state_name),
                Some(&current.name),
            ))
        }
        Err(_) => return Some(unavailable("terminate_failed")),
    };
    let configured_destination = issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&item.issue_type_id))
        .filter(issue_type_transition::Column::FromStateId.eq(&launch.id))
        .filter(issue_type_transition::Column::ToStateId.eq(&current.id))
        .one(database)
        .await;
    match configured_destination {
        Ok(Some(_)) => None,
        Ok(None) => Some(transition_required(
            Some(launch_state_name),
            Some(&current.name),
        )),
        Err(_) => Some(unavailable("terminate_failed")),
    }
}

fn transition_required(launch_state: Option<&str>, current_state: Option<&str>) -> Value {
    json!({
        "ok": false,
        "error": "ticket_transition_required",
        "launch_state": launch_state,
        "current_state": current_state,
    })
}

fn unavailable(error: &str) -> Value {
    json!({"ok": false, "error": error})
}
