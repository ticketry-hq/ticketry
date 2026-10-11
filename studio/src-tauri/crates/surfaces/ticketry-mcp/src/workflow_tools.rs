use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use ticketry_provider::{provider_contract, ProfileSelection, Provider};
use ticketry_work_management::{
    create_transition, delete_launch_binding, delete_transition, patch_launch_binding,
    update_issue_type, update_transition, CommandError, NewTransition, PatchLaunchBinding,
    PatchValue, RevisionedState, RevisionedTransition, TransitionPatch, UpdateIssueType,
};

use super::projection;

pub async fn dispatch(
    database: &DatabaseConnection,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<Value, CommandError> {
    let type_id = string(arguments, "type_id")?;
    match name {
        "add_issue_type_workflow_transition" => {
            create_transition(
                database,
                NewTransition {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                    agent_allowed: boolean_default(arguments, "agent_allowed", true)?,
                    handoff: boolean_default(arguments, "handoff", false)?,
                },
            )
            .await?;
        }
        "remove_issue_type_workflow_transition" => {
            delete_transition(
                database,
                RevisionedTransition {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_transition_permission" => {
            update_transition(
                database,
                TransitionPatch {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    agent_allowed: optional_boolean(arguments, "agent_allowed")?,
                    handoff: optional_boolean(arguments, "handoff")?,
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_start_state" => {
            update_issue_type(
                database,
                UpdateIssueType {
                    id: type_id.to_owned(),
                    name: None,
                    color: None,
                    sort_order: None,
                    start_state_id: Some(string(arguments, "state_id")?.to_owned()),
                    workflow_revision: Some(integer(arguments, "workflow_revision")?),
                },
            )
            .await?;
        }
        "clear_issue_type_workflow_launch_binding" => {
            delete_launch_binding(
                database,
                RevisionedState {
                    issue_type_id: type_id.to_owned(),
                    state_id: string(arguments, "state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_auto_start" => {
            patch_launch_binding(
                database,
                PatchLaunchBinding {
                    issue_type_id: type_id.to_owned(),
                    state_id: string(arguments, "state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                    prompt: PatchValue::Unset,
                    required_skills: PatchValue::Unset,
                    stage_skills: PatchValue::Unset,
                    profile: PatchValue::Unset,
                    model_id: PatchValue::Unset,
                    reasoning_id: PatchValue::Unset,
                    auto_start: PatchValue::Value(boolean(arguments, "auto_start")?),
                    subtree_run_enabled: PatchValue::Unset,
                },
            )
            .await?;
        }
        "upsert_issue_type_workflow_launch_binding" => {
            upsert_launch_binding(database, arguments).await?;
        }
        _ => return Err(CommandError::validation("Unknown workflow tool.")),
    }
    Ok(projection::workflow_settings(database, type_id).await)
}

async fn upsert_launch_binding(
    database: &DatabaseConnection,
    arguments: &Map<String, Value>,
) -> Result<(), CommandError> {
    let type_id = string(arguments, "type_id")?;
    let state_id = string(arguments, "state_id")?;
    let agent = optional_string(arguments, "agent");
    let selected_provider = if let Some(agent) = agent {
        let provider = ticketry_work_management::providers(database)
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
        Some(provider)
    } else {
        None
    };
    let profile = patch_string(arguments, "profile")?;
    ensure_profile_supported(
        selected_provider
            .as_ref()
            .map(|provider| provider.slug.as_str()),
        &profile,
    )?;
    let model_id = match arguments.get("model") {
        None => PatchValue::Unset,
        Some(Value::Null) => PatchValue::Null,
        Some(Value::String(model_name)) => {
            let models = ticketry_work_management::agent_models(database).await?;
            PatchValue::Value(
                models
                    .iter()
                    .find(|model| {
                        model.name == *model_name
                            && selected_provider
                                .as_ref()
                                .is_none_or(|provider| provider.id == model.provider)
                    })
                    .map(|model| model.id.clone())
                    .ok_or_else(|| {
                        CommandError::field("model", "Could not resolve that catalog model.")
                    })?,
            )
        }
        Some(_) => {
            return Err(CommandError::field(
                "model",
                "model must be a string or null.",
            ))
        }
    };
    let reasoning_id = match arguments.get("reasoning") {
        None => PatchValue::Unset,
        Some(Value::Null) => PatchValue::Null,
        Some(Value::String(name)) => PatchValue::Value(
            ticketry_work_management::reasoning_levels(database)
                .await?
                .into_iter()
                .find(|row| row.name == *name)
                .map(|row| row.id)
                .ok_or_else(|| {
                    CommandError::field("reasoning", "Could not resolve that reasoning level.")
                })?,
        ),
        Some(_) => {
            return Err(CommandError::field(
                "reasoning",
                "reasoning must be a string or null.",
            ))
        }
    };
    patch_launch_binding(
        database,
        PatchLaunchBinding {
            issue_type_id: type_id.to_owned(),
            state_id: state_id.to_owned(),
            workflow_revision: integer(arguments, "workflow_revision")?,
            prompt: patch_string(arguments, "prompt")?,
            required_skills: patch_strings(arguments, "required_skills")?,
            stage_skills: patch_strings(arguments, "stage_skills")?,
            profile,
            model_id,
            reasoning_id,
            auto_start: PatchValue::Unset,
            subtree_run_enabled: PatchValue::Unset,
        },
    )
    .await?;
    Ok(())
}

/// Only Codex reads a launch profile; every other provider launches from model
/// and reasoning, so a profile named alongside one is a silently wrong launch.
pub(crate) fn ensure_profile_supported(
    provider_slug: Option<&str>,
    profile: &PatchValue<String>,
) -> Result<(), CommandError> {
    let (Some(provider_slug), PatchValue::Value(_)) = (provider_slug, profile) else {
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

pub fn rejection(error: &CommandError) -> Value {
    let mut body = json!({"ok": false, "detail": error.to_string(), "code": error.code()});
    if let Some(field) = error.field_name() {
        body["field"] = Value::String(field.to_owned());
    }
    if let Some(from) = error.from_state() {
        body["from"] = Value::String(from.to_owned());
    }
    if let Some(to) = error.to_state() {
        body["to"] = Value::String(to.to_owned());
    }
    body
}

pub fn string<'a>(arguments: &'a Map<String, Value>, name: &str) -> Result<&'a str, CommandError> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::field("arguments", format!("{name} is required.")))
}

pub fn optional_string<'a>(arguments: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    arguments.get(name).and_then(Value::as_str)
}

pub fn integer(arguments: &Map<String, Value>, name: &str) -> Result<i32, CommandError> {
    arguments
        .get(name)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| CommandError::field("arguments", format!("{name} must be an integer.")))
}

pub fn boolean(arguments: &Map<String, Value>, name: &str) -> Result<bool, CommandError> {
    arguments
        .get(name)
        .and_then(Value::as_bool)
        .ok_or_else(|| CommandError::field("arguments", format!("{name} must be a boolean.")))
}

fn optional_boolean(
    arguments: &Map<String, Value>,
    name: &'static str,
) -> Result<Option<bool>, CommandError> {
    arguments.get(name).map_or(Ok(None), |value| {
        value
            .as_bool()
            .map(Some)
            .ok_or_else(|| CommandError::field(name, format!("{name} must be a boolean.")))
    })
}

fn boolean_default(
    arguments: &Map<String, Value>,
    name: &str,
    default: bool,
) -> Result<bool, CommandError> {
    arguments.get(name).map_or(Ok(default), |value| {
        value
            .as_bool()
            .ok_or_else(|| CommandError::field("arguments", format!("{name} must be a boolean.")))
    })
}

fn patch_string(
    arguments: &Map<String, Value>,
    name: &'static str,
) -> Result<PatchValue<String>, CommandError> {
    match arguments.get(name) {
        None => Ok(PatchValue::Unset),
        Some(Value::Null) => Ok(PatchValue::Null),
        Some(Value::String(value)) => Ok(PatchValue::Value(value.clone())),
        Some(_) => Err(CommandError::field(
            name,
            format!("{name} must be a string or null."),
        )),
    }
}

fn patch_strings(
    arguments: &Map<String, Value>,
    name: &'static str,
) -> Result<PatchValue<Vec<String>>, CommandError> {
    match arguments.get(name) {
        None => Ok(PatchValue::Unset),
        Some(Value::Null) => Ok(PatchValue::Null),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    CommandError::field(name, format!("{name} values must be strings."))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(PatchValue::Value),
        Some(_) => Err(CommandError::field(
            name,
            format!("{name} must be an array or null."),
        )),
    }
}
