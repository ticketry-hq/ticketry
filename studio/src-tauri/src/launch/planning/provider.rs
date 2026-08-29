use serde::{Deserialize, Serialize};

use super::{LaunchPlanningError, LaunchPlanningErrorCode, ProviderOptions};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
    Gemini,
    Agy,
}

impl TryFrom<&str> for Provider {
    type Error = LaunchPlanningError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            "gemini" => Ok(Self::Gemini),
            "agy" => Ok(Self::Agy),
            _ => Err(LaunchPlanningError::new(
                LaunchPlanningErrorCode::UnknownProvider,
                format!("Provider '{value}' is not registered."),
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimeoutUnit {
    Seconds,
    Milliseconds,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderContract {
    pub slug: &'static str,
    pub supports_model: bool,
    pub supports_reasoning: bool,
    pub supports_resume: bool,
    pub supports_worktracker_mcp: bool,
    pub supports_required_skills: bool,
    pub hook_events: &'static [&'static str],
    pub hook_timeout: u64,
    pub hook_timeout_unit: TimeoutUnit,
    pub settings_environment: Option<&'static str>,
}

const CLAUDE_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
];
const CODEX_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
];
const GEMINI_EVENTS: &[&str] = &[
    "SessionStart",
    "BeforeAgent",
    "BeforeTool",
    "AfterTool",
    "Notification",
    "AfterAgent",
    "SessionEnd",
];
const AGY_EVENTS: &[&str] = &[
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "SessionEnd",
];

pub fn provider_contract(provider: Provider) -> ProviderContract {
    match provider {
        Provider::Claude => contract("claude", true, CLAUDE_EVENTS, 5, TimeoutUnit::Seconds, None),
        Provider::Codex => contract("codex", true, CODEX_EVENTS, 5, TimeoutUnit::Seconds, None),
        Provider::Gemini => contract(
            "gemini",
            false,
            GEMINI_EVENTS,
            5_000,
            TimeoutUnit::Milliseconds,
            Some("GEMINI_CLI_SYSTEM_SETTINGS_PATH"),
        ),
        Provider::Agy => contract(
            "agy",
            false,
            AGY_EVENTS,
            5_000,
            TimeoutUnit::Milliseconds,
            Some("GEMINI_CLI_SYSTEM_SETTINGS_PATH"),
        ),
    }
}

fn contract(
    slug: &'static str,
    reasoning: bool,
    events: &'static [&'static str],
    timeout: u64,
    timeout_unit: TimeoutUnit,
    settings_environment: Option<&'static str>,
) -> ProviderContract {
    ProviderContract {
        slug,
        supports_model: true,
        supports_reasoning: reasoning,
        supports_resume: true,
        supports_worktracker_mcp: true,
        supports_required_skills: true,
        hook_events: events,
        hook_timeout: timeout,
        hook_timeout_unit: timeout_unit,
        settings_environment,
    }
}

pub(crate) fn validate_options(
    provider: Provider,
    options: &ProviderOptions,
) -> Result<(), LaunchPlanningError> {
    let contract = provider_contract(provider);
    if options
        .model
        .as_deref()
        .is_some_and(|value| !valid_option(value))
    {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::UnsupportedModel,
            "Model must be omitted or non-empty.",
        ));
    }
    if options.reasoning.is_some() && !contract.supports_reasoning {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::UnsupportedReasoning,
            format!("Provider '{}' does not support reasoning.", contract.slug),
        ));
    }
    if options
        .reasoning
        .as_deref()
        .is_some_and(|value| !valid_option(value))
    {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::UnsupportedReasoning,
            "Reasoning must be omitted or non-empty.",
        ));
    }
    Ok(())
}

fn valid_option(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
        })
}
