//! One issue type's live workflow policy as agents read it: start state,
//! revision-guarded transitions, launch bindings and standing warnings.

use std::collections::{HashMap, HashSet};

use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use ticketry_work_management::{
    read_queries,
    read_types::{IssueType, IssueTypeTransition, State},
};

use super::same_id;

pub async fn workflow_settings(database: &DatabaseConnection, type_id: &str) -> Value {
    let Some(kind) = read_queries::issue_type(database, type_id)
        .await
        .ok()
        .flatten()
    else {
        return json!({"ok": false, "code": "not_found", "detail": "Work-item type not found."});
    };
    let transitions = read_queries::transitions(database, type_id)
        .await
        .unwrap_or_default();
    let states = read_queries::states(database, &kind.project)
        .await
        .unwrap_or_default();
    let bindings = read_queries::launch_bindings(database, &kind.project)
        .await
        .unwrap_or_default();
    let providers = read_queries::providers(database).await.unwrap_or_default();
    let models = read_queries::agent_models(database)
        .await
        .unwrap_or_default();
    let reasoning = read_queries::reasoning_levels(database)
        .await
        .unwrap_or_default();
    let model_map: HashMap<_, _> = models.iter().map(|row| (row.id.as_str(), row)).collect();
    let provider_map: HashMap<_, _> = providers.iter().map(|row| (row.id.as_str(), row)).collect();
    let reasoning_map: HashMap<_, _> = reasoning.iter().map(|row| (row.id.as_str(), row)).collect();
    let mut warnings = workflow_warnings(&kind, &states, &transitions);
    let launch_bindings = bindings
        .iter()
        .filter(|binding| same_id(&binding.issue_type, type_id))
        .map(|binding| {
            let model = binding.model.as_deref().and_then(|id| model_map.get(id).copied());
            let provider = model.and_then(|model| provider_map.get(model.provider.as_str()).copied());
            if provider.is_some_and(|provider| !provider.activated) {
                let state_name = states
                    .iter()
                    .find(|state| state.id == binding.state)
                    .map(|state| state.name.as_str())
                    .unwrap_or("This state");
                let provider_slug = provider
                    .map(|provider| provider.slug.as_str())
                    .unwrap_or_default();
                warnings.push(json!({
                    "code": "provider_not_activated",
                    "state_id": binding.state,
                    "message": format!(
                        "{state_name} launches with {provider_slug}, which is deactivated in Settings → Model configuration; those launches are blocked."
                    ),
                }));
            }
            json!({
                "state_id": binding.state,
                "prompt": binding.prompt,
                "required_skills": binding.required_skills.0,
                "stage_skills": binding.stage_skills.0,
                "profile": binding.profile,
                "agent": provider.map(|row| row.slug.as_str()),
                "model": model.map(|row| row.name.as_str()),
                "reasoning": binding.reasoning.as_deref().and_then(|id| reasoning_map.get(id)).map(|row| row.name.as_str()),
                "auto_start": binding.auto_start,
                "subtree_run_enabled": binding.subtree_run_enabled,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "issue_type_id": kind.id,
        "start_state_id": kind.start_state,
        "workflow_revision": kind.workflow_revision,
        "transitions": transitions.into_iter().map(|edge| json!({
            "from_state_id": edge.from_state, "to_state_id": edge.to_state,
            "agent_allowed": edge.agent_allowed, "handoff": edge.handoff
        })).collect::<Vec<_>>(),
        "launch_bindings": launch_bindings,
        "warnings": warnings,
    })
}

fn workflow_warnings(
    kind: &IssueType,
    states: &[State],
    transitions: &[IssueTypeTransition],
) -> Vec<Value> {
    let Some(start_state) = kind
        .start_state
        .as_ref()
        .filter(|id| states.iter().any(|state| state.id == id.as_str()))
    else {
        return vec![json!({
            "code": "start_state_not_configured",
            "state_id": null,
            "message": "No start state is configured for this work-item type."
        })];
    };
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut reverse: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in transitions {
        adjacency
            .entry(edge.from_state.as_str())
            .or_default()
            .push(edge.to_state.as_str());
        reverse
            .entry(edge.to_state.as_str())
            .or_default()
            .push(edge.from_state.as_str());
    }
    let members = reachable([start_state.as_str()], &adjacency);
    let completed = states
        .iter()
        .filter(|state| members.contains(state.id.as_str()) && state.group == "completed")
        .map(|state| state.id.as_str());
    let can_reach_completed = reachable(completed, &reverse);
    states
        .iter()
        .filter(|state| {
            members.contains(state.id.as_str()) && !can_reach_completed.contains(state.id.as_str())
        })
        .map(|state| {
            json!({
                "code": "no_path_to_completed",
                "state_id": state.id,
                "message": format!("{} has no path to a completed state.", state.name),
            })
        })
        .collect()
}

fn reachable<'a>(
    seeds: impl IntoIterator<Item = &'a str>,
    graph: &HashMap<&'a str, Vec<&'a str>>,
) -> HashSet<&'a str> {
    let mut seen: HashSet<&str> = seeds.into_iter().collect();
    let mut pending: Vec<&str> = seen.iter().copied().collect();
    while let Some(current) = pending.pop() {
        for neighbor in graph.get(current).into_iter().flatten() {
            if seen.insert(neighbor) {
                pending.push(neighbor);
            }
        }
    }
    seen
}
