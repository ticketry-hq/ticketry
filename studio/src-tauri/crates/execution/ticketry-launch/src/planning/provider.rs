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
    pub invocation_prefix: &'static str,
    pub ready_composer_marker: Option<&'static str>,
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

impl ProviderContract {
    pub fn is_ready_composer(self, screen: &[u8]) -> bool {
        let Some(marker) = self.ready_composer_marker else {
            return false;
        };
        let rendered = String::from_utf8_lossy(screen);
        strip_terminal_controls(&rendered)
            .lines()
            .any(|line| line.trim_start().starts_with(marker))
    }
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
        Provider::Claude => contract(
            "claude",
            "/",
            Some("\u{276f}"),
            true,
            CLAUDE_EVENTS,
            5,
            TimeoutUnit::Seconds,
            None,
        ),
        Provider::Codex => contract(
            "codex",
            "$",
            Some("\u{203a} Ask Codex"),
            true,
            CODEX_EVENTS,
            5,
            TimeoutUnit::Seconds,
            None,
        ),
        Provider::Gemini => contract(
            "gemini",
            "/",
            Some("> Type your message"),
            false,
            GEMINI_EVENTS,
            5_000,
            TimeoutUnit::Milliseconds,
            Some("GEMINI_CLI_SYSTEM_SETTINGS_PATH"),
        ),
        Provider::Agy => contract(
            "agy",
            "/",
            Some("> you:"),
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
    invocation_prefix: &'static str,
    ready_composer_marker: Option<&'static str>,
    reasoning: bool,
    events: &'static [&'static str],
    timeout: u64,
    timeout_unit: TimeoutUnit,
    settings_environment: Option<&'static str>,
) -> ProviderContract {
    ProviderContract {
        slug,
        invocation_prefix,
        ready_composer_marker,
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

fn strip_terminal_controls(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            output.push(character);
            continue;
        }
        match characters.next() {
            Some('[') => {
                for control in characters.by_ref() {
                    if ('@'..='~').contains(&control) {
                        break;
                    }
                }
            }
            Some(']') => {
                let mut previous_escape = false;
                for control in characters.by_ref() {
                    if control == '\u{7}' || (previous_escape && control == '\\') {
                        break;
                    }
                    previous_escape = control == '\u{1b}';
                }
            }
            Some(_) | None => {}
        }
    }
    output
}

pub fn validate_options(
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

#[cfg(test)]
mod prompt_delivery_contract_tests {
    use super::*;

    #[test]
    fn provider_contracts_own_invocation_prefixes_and_ready_composer_markers() {
        let cases = [
            (Provider::Claude, "/", "\u{1b}[32m\u{276f}\u{1b}[0m "),
            (Provider::Codex, "$", "\u{203a} Ask Codex to do anything"),
            (
                Provider::Gemini,
                "/",
                "> Type your message or @path/to/file",
            ),
            (Provider::Agy, "/", "> you: "),
        ];

        for (provider, prefix, screen) in cases {
            let contract = provider_contract(provider);
            assert_eq!(contract.invocation_prefix, prefix);
            assert!(contract.is_ready_composer(screen.as_bytes()));
        }
    }

    #[test]
    fn codex_startup_prompt_is_not_a_ready_composer() {
        assert!(!provider_contract(Provider::Codex)
            .is_ready_composer("\u{203a} Selected workflow prompt:\n  Start the task".as_bytes()));
    }

    #[test]
    fn a_contract_without_a_marker_is_never_ready() {
        let mut contract = provider_contract(Provider::Claude);
        contract.ready_composer_marker = None;

        assert!(!contract.is_ready_composer(b"ready"));
    }
}
