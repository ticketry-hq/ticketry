use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use crate::work_management::{
    commands::{catalog, workflow, CommandError},
    read_queries,
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
            workflow::create_transition(
                database,
                workflow::NewTransition {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                    agent_allowed: boolean_default(arguments, "agent_allowed", true)?,
                },
            )
            .await?;
        }
        "remove_issue_type_workflow_transition" => {
            workflow::delete_transition(
                database,
                workflow::RevisionedTransition {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_transition_permission" => {
            workflow::update_transition(
                database,
                workflow::TransitionPatch {
                    issue_type_id: type_id.to_owned(),
                    from_state_id: string(arguments, "from_state_id")?.to_owned(),
                    to_state_id: string(arguments, "to_state_id")?.to_owned(),
                    agent_allowed: boolean(arguments, "agent_allowed")?,
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_start_state" => {
            catalog::update_issue_type(
                database,
                catalog::UpdateIssueType {
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
            workflow::delete_launch_binding(
                database,
                workflow::RevisionedState {
                    issue_type_id: type_id.to_owned(),
                    state_id: string(arguments, "state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                },
            )
            .await?;
        }
        "set_issue_type_workflow_auto_start" => {
            workflow::patch_launch_binding(
                database,
                workflow::PatchLaunchBinding {
                    issue_type_id: type_id.to_owned(),
                    state_id: string(arguments, "state_id")?.to_owned(),
                    workflow_revision: integer(arguments, "workflow_revision")?,
                    prompt: workflow::PatchValue::Unset,
                    required_skills: workflow::PatchValue::Unset,
                    entry_skill: workflow::PatchValue::Unset,
                    model_id: workflow::PatchValue::Unset,
                    reasoning_id: workflow::PatchValue::Unset,
                    auto_start: workflow::PatchValue::Value(boolean(arguments, "auto_start")?),
                    subtree_run_enabled: workflow::PatchValue::Unset,
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
        Some(provider)
    } else {
        None
    };
    let model_id = match arguments.get("model") {
        None => workflow::PatchValue::Unset,
        Some(Value::Null) => workflow::PatchValue::Null,
        Some(Value::String(model_name)) => {
            let models = read_queries::agent_models(database).await?;
            workflow::PatchValue::Value(
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
        None => workflow::PatchValue::Unset,
        Some(Value::Null) => workflow::PatchValue::Null,
        Some(Value::String(name)) => workflow::PatchValue::Value(
            read_queries::reasoning_levels(database)
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
    workflow::patch_launch_binding(
        database,
        workflow::PatchLaunchBinding {
            issue_type_id: type_id.to_owned(),
            state_id: state_id.to_owned(),
            workflow_revision: integer(arguments, "workflow_revision")?,
            prompt: patch_string(arguments, "prompt")?,
            required_skills: patch_strings(arguments, "required_skills")?,
            entry_skill: patch_string(arguments, "entry_skill")?,
            model_id,
            reasoning_id,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await?;
    Ok(())
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
) -> Result<workflow::PatchValue<String>, CommandError> {
    match arguments.get(name) {
        None => Ok(workflow::PatchValue::Unset),
        Some(Value::Null) => Ok(workflow::PatchValue::Null),
        Some(Value::String(value)) => Ok(workflow::PatchValue::Value(value.clone())),
        Some(_) => Err(CommandError::field(
            name,
            format!("{name} must be a string or null."),
        )),
    }
}

fn patch_strings(
    arguments: &Map<String, Value>,
    name: &'static str,
) -> Result<workflow::PatchValue<Vec<String>>, CommandError> {
    match arguments.get(name) {
        None => Ok(workflow::PatchValue::Unset),
        Some(Value::Null) => Ok(workflow::PatchValue::Null),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    CommandError::field(name, format!("{name} values must be strings."))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(workflow::PatchValue::Value),
        Some(_) => Err(CommandError::field(
            name,
            format!("{name} must be an array or null."),
        )),
    }
}
