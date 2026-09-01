//! The reviewed state, issue-type, workflow, and launch-binding catalog.
//!
//! Both a newly created Project and the installation Project provisioned on a
//! first launch need the same catalog. Keeping that aggregate write here gives
//! both paths one SeaORM implementation and one set of reviewed defaults.

use std::collections::HashMap;

use super::identifiers::new_database_uuid;
use super::{reviewed_defaults, CommandError};
use sea_orm::{ActiveModelTrait, ConnectionTrait, Set};
use ticketry_entities::{issue_type, issue_type_transition, launch_binding, state};

pub async fn seed(database: &impl ConnectionTrait, project_id: &str) -> Result<(), CommandError> {
    let defaults = reviewed_defaults::load()
        .map_err(|_| CommandError::Storage("Reviewed project defaults are invalid.".to_owned()))?;
    let now = super::timestamp::now();

    let mut state_ids = HashMap::new();
    for (sort_order, seed) in defaults.states.iter().enumerate() {
        let state_id = new_database_uuid();
        state_ids.insert(seed.name.clone(), state_id.clone());
        state::ActiveModel {
            id: Set(state_id),
            project_id: Set(project_id.to_owned()),
            name: Set(seed.name.clone()),
            group: Set(seed.group.clone()),
            color: Set(seed.color.clone()),
            sort_order: Set(sort_order as i32),
            is_protected: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(database)
        .await?;
    }

    let mut type_ids = HashMap::new();
    for (sort_order, (type_name, level)) in std::iter::once(("Module", "module"))
        .chain(
            defaults
                .issue_types
                .iter()
                .map(|name| (name.as_str(), "task")),
        )
        .enumerate()
    {
        let type_id = new_database_uuid();
        type_ids.insert(type_name.to_owned(), type_id.clone());
        let start_state_id = defaults
            .workflows
            .get(type_name)
            .and_then(|workflow| state_ids.get(&workflow.start))
            .cloned();
        issue_type::ActiveModel {
            id: Set(type_id),
            project_id: Set(project_id.to_owned()),
            name: Set(type_name.to_owned()),
            level: Set(level.to_owned()),
            color: Set(String::new()),
            sort_order: Set(sort_order as i32),
            start_state_id: Set(start_state_id),
            workflow_revision: Set(i32::from(level == "task")),
            is_pathfind: Set(type_name == "PathFind"),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(database)
        .await?;
    }

    for (type_name, workflow) in &defaults.workflows {
        let type_id = &type_ids[type_name];
        for (from, to, metadata) in &workflow.transitions {
            issue_type_transition::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_type_id: Set(type_id.clone()),
                from_state_id: Set(state_ids[from].clone()),
                to_state_id: Set(state_ids[to].clone()),
                agent_allowed: Set(metadata.agent_allowed),
            }
            .insert(database)
            .await?;
        }
    }

    for type_name in &defaults.issue_types {
        let workflow = &defaults.workflows[type_name];
        for state_seed in defaults
            .states
            .iter()
            .filter(|state| workflow.states.contains(&state.name))
        {
            let prompt = defaults
                .prompts
                .get(type_name)
                .and_then(|prompts| prompts.get(&state_seed.name))
                .cloned()
                .unwrap_or_default();
            let required_skills = defaults
                .required_skills
                .get(&state_seed.name)
                .cloned()
                .unwrap_or_default();
            launch_binding::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_type_id: Set(type_ids[type_name].clone()),
                state_id: Set(state_ids[&state_seed.name].clone()),
                prompt: Set(prompt),
                required_skills: Set(serde_json::json!(required_skills)),
                model_id: Set(None),
                reasoning_id: Set(None),
                auto_start: Set(state_seed.auto_start),
                subtree_run_enabled: Set(type_name == "Story" && state_seed.name != "Ideas"),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(database)
            .await?;
        }
    }
    Ok(())
}
