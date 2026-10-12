//! Create or patch one state's launch binding. Every patch field keeps the
//! caller's omitted / null / value choice through to the one
//! `workflow::patch_launch_binding` command; catalog names resolve to ids here.

use rmcp::schemars::JsonSchema;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use ticketry_provider::{provider_contract, ProfileSelection, Provider};
use ticketry_work_management::{
    commands::{workflow, CommandError},
    read_queries,
    read_types::Provider as ProviderRow,
};

use super::super::tool_surface::PatchInput;

// `agent` only narrows provider validation and model lookup: omitted and null
// both mean no provider. `entry_skill` is not published, and like any unknown
// key it is ignored.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub(super) struct LaunchBindingUpsert {
    pub(super) type_id: String,
    state_id: String,
    workflow_revision: i32,
    #[serde(default)]
    prompt: PatchInput<String>,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    profile: PatchInput<String>,
    #[serde(default)]
    model: PatchInput<String>,
    #[serde(default)]
    reasoning: PatchInput<String>,
    #[serde(default)]
    required_skills: PatchInput<Vec<String>>,
    #[serde(default)]
    stage_skills: PatchInput<Vec<String>>,
}

pub(super) async fn upsert(
    database: DatabaseConnection,
    upsert: LaunchBindingUpsert,
) -> Result<(), CommandError> {
    let database = &database;
    let selected_provider = match upsert.agent.as_deref() {
        Some(agent) => Some(activated_provider(database, agent).await?),
        None => None,
    };
    let profile = upsert.profile.into();
    ensure_profile_supported(
        selected_provider
            .as_ref()
            .map(|provider| provider.slug.as_str()),
        &profile,
    )?;
    let model_id = match upsert.model {
        PatchInput::Omitted => workflow::PatchValue::Unset,
        PatchInput::Null => workflow::PatchValue::Null,
        PatchInput::Value(model_name) => workflow::PatchValue::Value(
            read_queries::agent_models(database)
                .await?
                .into_iter()
                .find(|model| {
                    model.name == model_name
                        && selected_provider
                            .as_ref()
                            .is_none_or(|provider| provider.id == model.provider)
                })
                .map(|model| model.id)
                .ok_or_else(|| {
                    CommandError::field("model", "Could not resolve that catalog model.")
                })?,
        ),
    };
    let reasoning_id = match upsert.reasoning {
        PatchInput::Omitted => workflow::PatchValue::Unset,
        PatchInput::Null => workflow::PatchValue::Null,
        PatchInput::Value(name) => workflow::PatchValue::Value(
            read_queries::reasoning_levels(database)
                .await?
                .into_iter()
                .find(|row| row.name == name)
                .map(|row| row.id)
                .ok_or_else(|| {
                    CommandError::field("reasoning", "Could not resolve that reasoning level.")
                })?,
        ),
    };
    workflow::patch_launch_binding(
        database,
        workflow::PatchLaunchBinding {
            issue_type_id: upsert.type_id,
            state_id: upsert.state_id,
            workflow_revision: upsert.workflow_revision,
            prompt: upsert.prompt.into(),
            required_skills: upsert.required_skills.into(),
            stage_skills: upsert.stage_skills.into(),
            profile,
            model_id,
            reasoning_id,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await?;
    Ok(())
}

async fn activated_provider(
    database: &DatabaseConnection,
    agent: &str,
) -> Result<ProviderRow, CommandError> {
    let provider = read_queries::providers(database)
        .await?
        .into_iter()
        .find(|provider| provider.slug == agent)
        .ok_or_else(|| CommandError::Rejected {
            message: format!("Agent/provider '{agent}' is not supported."),
            code: "unknown_agent",
            field: Some("agent"),
        })?;
    if !provider.activated {
        return Err(CommandError::Rejected {
            message: format!("Agent/provider '{agent}' is not activated."),
            code: "provider_not_activated",
            field: Some("agent"),
        });
    }
    Ok(provider)
}

/// Only Codex reads a launch profile; every other provider launches from model
/// and reasoning, so a profile named alongside one is a silently wrong launch.
pub(crate) fn ensure_profile_supported(
    provider_slug: Option<&str>,
    profile: &workflow::PatchValue<String>,
) -> Result<(), CommandError> {
    let (Some(provider_slug), workflow::PatchValue::Value(_)) = (provider_slug, profile) else {
        return Ok(());
    };
    let incompatible = || CommandError::Rejected {
        message: "Only Codex supports launch profiles.".to_owned(),
        code: "incompatible_profile",
        field: Some("profile"),
    };
    let provider = Provider::from_slug(provider_slug).ok_or_else(|| incompatible())?;
    let profile = "configured".to_owned();
    provider_contract(provider)
        .validate_profile_selection(
            ProfileSelection {
                profile: Some(&profile),
                model: None,
                effort: None,
            },
            std::slice::from_ref(&profile),
        )
        .map_err(|_| incompatible())
}
