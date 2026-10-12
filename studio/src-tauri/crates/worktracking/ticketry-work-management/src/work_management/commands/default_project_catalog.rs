//! The catalog a new Project starts with, chosen by the compiled edition.
//!
//! Both a newly created Project and the installation Project provisioned on a
//! first launch need the same catalog. Keeping that aggregate write here gives
//! both paths one SeaORM implementation and one set of defaults.
//!
//! Editions granting `reviewedWorkflowDefaults` (Pocock) seed the reviewed
//! state, issue-type, workflow, and launch-binding catalog. Every other
//! edition (core) seeds an empty workflow slate: only the structural,
//! module-level `Module` type with no start state, because module creation,
//! onboarding's first-module step and the Module Manager require it.

use std::collections::HashMap;

use super::identifiers::new_database_uuid;
use super::{reviewed_defaults, CommandError};
use sea_orm::{ActiveModelTrait, ConnectionTrait, Set};
use ticketry_edition::EditionCapability;
use ticketry_entities::{issue_type, issue_type_transition, launch_binding, state};

pub async fn seed(database: &impl ConnectionTrait, project_id: &str) -> Result<(), CommandError> {
    if ticketry_edition::has(EditionCapability::ReviewedWorkflowDefaults) {
        seed_reviewed_catalog(database, project_id).await
    } else {
        let now = super::timestamp::now();
        insert_issue_type(database, project_id, "Module", "module", 0, None, now).await?;
        Ok(())
    }
}

async fn seed_reviewed_catalog(
    database: &impl ConnectionTrait,
    project_id: &str,
) -> Result<(), CommandError> {
    let defaults = reviewed_defaults::load()
        .map_err(|_| CommandError::Storage("Reviewed project defaults are invalid.".to_owned()))?;
    let stage_skills = reviewed_defaults::stage_skill_seeds()
        .into_iter()
        .collect::<HashMap<_, _>>();
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
        let start_state_name = defaults
            .workflows
            .get(type_name)
            .map(|workflow| workflow.start.as_str())
            .or_else(|| (type_name == "Module").then_some("Ideas"));
        let start_state_id = start_state_name
            .and_then(|name| state_ids.get(name))
            .cloned();
        let type_id = insert_issue_type(
            database,
            project_id,
            type_name,
            level,
            sort_order as i32,
            start_state_id,
            now,
        )
        .await?;
        type_ids.insert(type_name.to_owned(), type_id);
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
                handoff: Set(false),
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
                stage_skills: Set(serde_json::json!(stage_skills
                    .get(&state_seed.name)
                    .into_iter()
                    .cloned()
                    .collect::<Vec<_>>())),
                profile: Set(None),
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

async fn insert_issue_type(
    database: &impl ConnectionTrait,
    project_id: &str,
    name: &str,
    level: &str,
    sort_order: i32,
    start_state_id: Option<String>,
    now: sea_orm::prelude::DateTime,
) -> Result<String, CommandError> {
    let type_id = new_database_uuid();
    issue_type::ActiveModel {
        id: Set(type_id.clone()),
        project_id: Set(project_id.to_owned()),
        name: Set(name.to_owned()),
        level: Set(level.to_owned()),
        color: Set(String::new()),
        sort_order: Set(sort_order),
        start_state_id: Set(start_state_id),
        workflow_revision: Set(i32::from(level == "task")),
        is_pathfind: Set(name == "PathFind"),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(database)
    .await?;
    Ok(type_id)
}
