use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use serde::Deserialize;

use super::super::CommandError;
use crate::settings_persistence::read_global_launch_default;
use crate::entities::work_management::{agent_model, agent_model_reasoning_level, provider};

const REQUIRED_SKILL_LOCK: &str = include_str!("../../../../resources/launch/skills.lock.json");

pub(super) struct LaunchBindingCandidate<'a> {
    pub prompt: &'a str,
    pub required_skills: &'a [String],
    pub model_id: Option<&'a str>,
    pub reasoning_id: Option<&'a str>,
    pub auto_start: bool,
    pub subtree_run_enabled: bool,
}

#[derive(Deserialize)]
struct RequiredSkillLock {
    selected_packages: Vec<String>,
}

struct ProviderSelection {
    slug: String,
    activated: bool,
    supports_unattended: bool,
}

pub(super) async fn validate_launch_binding(
    database: &impl ConnectionTrait,
    candidate: LaunchBindingCandidate<'_>,
) -> Result<(), CommandError> {
    validate_required_skills(candidate.required_skills, candidate.prompt)?;
    if candidate.reasoning_id.is_some() && candidate.model_id.is_none() {
        return Err(rejected(
            "model_id",
            "model_required",
            "Choose a catalog model before configuring reasoning.",
        ));
    }

    let provider = match candidate.model_id {
        Some(model_id) => Some(provider_for_model(database, model_id).await?),
        None => None,
    };
    if let (Some(model_id), Some(reasoning_id)) = (candidate.model_id, candidate.reasoning_id) {
        validate_reasoning(database, model_id, reasoning_id).await?;
    }

    if candidate.auto_start || candidate.subtree_run_enabled {
        let field = automation_field(candidate.auto_start);
        let provider = match provider {
            Some(provider) => provider,
            None => unattended_default_provider(database).await?.ok_or_else(|| {
                rejected(
                    field,
                    "agent_not_configured",
                    "Choose an agent/provider that can launch unattended before enabling automation.",
                )
            })?,
        };
        if !provider.activated {
            return Err(rejected(
                field,
                "provider_not_activated",
                format!(
                    "Agent/provider '{}' must be activated before it can be used by a launch binding.",
                    provider.slug
                ),
            ));
        }
        if !provider.supports_unattended {
            return Err(rejected(
                field,
                "unattended_launch_unsupported",
                format!(
                    "Agent/provider '{}' cannot launch unattended.",
                    provider.slug
                ),
            ));
        }
    }
    Ok(())
}

fn validate_required_skills(values: &[String], prompt: &str) -> Result<(), CommandError> {
    let lock: RequiredSkillLock = serde_json::from_str(REQUIRED_SKILL_LOCK)
        .map_err(|_| CommandError::validation("The pinned required-skill catalog is invalid."))?;
    let mut seen = std::collections::HashSet::new();
    for identifier in values {
        if !lock.selected_packages.contains(identifier) {
            return Err(rejected(
                "required_skills",
                "invalid_required_skills",
                format!("Required skill '{identifier}' is not in the pinned upstream snapshot."),
            ));
        }
        if !seen.insert(identifier) {
            return Err(rejected(
                "required_skills",
                "invalid_required_skills",
                format!("Required skill '{identifier}' is declared more than once."),
            ));
        }
    }
    if !values.is_empty() && prompt.is_empty() {
        return Err(rejected(
            "prompt",
            "prompt_required_for_skills",
            "A launch binding with required skills must have a non-empty prompt.",
        ));
    }
    Ok(())
}

async fn provider_for_model(
    database: &impl ConnectionTrait,
    model_id: &str,
) -> Result<ProviderSelection, CommandError> {
    let row = agent_model::Entity::find_by_id(model_id)
        .find_also_related(provider::Entity)
        .one(database)
        .await?
        .ok_or_else(|| {
            rejected(
                "model_id",
                "unsupported_model",
                "Model is not in the agent catalog.",
            )
        })?;
    let provider = row.1.ok_or_else(|| {
        rejected(
            "model_id",
            "unsupported_model",
            "Model references no provider in the agent catalog.",
        )
    })?;
    let provider = ProviderSelection {
        slug: provider.slug,
        activated: provider.activated,
        supports_unattended: provider.supports_unattended,
    };
    if !provider.activated {
        return Err(rejected(
            "model_id",
            "provider_not_activated",
            format!(
                "Agent/provider '{}' must be activated before it can be used by a launch binding.",
                provider.slug
            ),
        ));
    }
    Ok(provider)
}

async fn validate_reasoning(
    database: &impl ConnectionTrait,
    model_id: &str,
    reasoning_id: &str,
) -> Result<(), CommandError> {
    let compatible = agent_model_reasoning_level::Entity::find()
        .filter(agent_model_reasoning_level::Column::AgentModelId.eq(model_id))
        .filter(agent_model_reasoning_level::Column::ReasoningLevelId.eq(reasoning_id))
        .one(database)
        .await?
        .is_some();
    if compatible {
        return Ok(());
    }
    Err(rejected(
        "reasoning_id",
        "unsupported_reasoning",
        "Reasoning is not permitted for the selected model.",
    ))
}

async fn unattended_default_provider(
    database: &impl ConnectionTrait,
) -> Result<Option<ProviderSelection>, CommandError> {
    let Some(default) = read_global_launch_default(database).await? else {
        return Ok(None);
    };
    Ok(provider::Entity::find()
        .filter(provider::Column::Slug.eq(default.provider))
        .one(database)
        .await?
        .map(|row| ProviderSelection {
            slug: row.slug,
            activated: row.activated,
            supports_unattended: row.supports_unattended,
        }))
}

fn automation_field(auto_start: bool) -> &'static str {
    if auto_start {
        "auto_start"
    } else {
        "subtree_run_enabled"
    }
}

fn rejected(field: &'static str, code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Rejected {
        message: message.into(),
        code,
        field: Some(field),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_skill_source_is_the_packaged_lock() {
        let lock: RequiredSkillLock = serde_json::from_str(REQUIRED_SKILL_LOCK).unwrap();
        assert_eq!(
            lock.selected_packages,
            [
                "code-review",
                "grill-with-docs",
                "implement",
                "tdd",
                "to-spec",
                "to-tickets",
            ]
        );
    }
}
