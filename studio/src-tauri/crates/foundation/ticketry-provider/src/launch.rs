use std::path::{Path, PathBuf};

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::{ProviderError, ProviderErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimeoutUnit {
    Seconds,
    Milliseconds,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderLaunchMetadata {
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

impl ProviderLaunchMetadata {
    pub fn is_ready_composer(self, screen: &[u8]) -> bool {
        let Some(marker) = self.ready_composer_marker else {
            return false;
        };
        strip_terminal_controls(&String::from_utf8_lossy(screen))
            .lines()
            .any(|line| line.trim_start().starts_with(marker))
    }

    pub fn composer_region(self, screen: &[u8]) -> Option<String> {
        let marker = self.ready_composer_marker?;
        let rendered = strip_terminal_controls(&String::from_utf8_lossy(screen));
        let composer = rendered
            .lines()
            .position(|line| line.trim_start().starts_with(marker))?;
        Some(
            rendered
                .lines()
                .skip(composer)
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderLaunchKind<'a> {
    Fresh,
    Resume { provider_session_id: &'a str },
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProviderOptions<'a> {
    pub profile: Option<&'a str>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

#[derive(Clone, Debug)]
pub struct LaunchConstructionRequest<'a> {
    pub executable: &'a Path,
    pub working_directory: &'a Path,
    pub kind: ProviderLaunchKind<'a>,
    pub agent_run_id: &'a str,
    pub prompt: Option<&'a str>,
    pub options: ProviderOptions<'a>,
    pub registered_profiles: &'a [String],
    pub hook_command: &'a str,
    pub mcp_server: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeSettings {
    pub environment_name: &'static str,
    pub contents: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderLaunch {
    pub argv: Vec<String>,
    pub working_directory: PathBuf,
    pub settings: Option<RuntimeSettings>,
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

pub(crate) fn claude(
    request: &LaunchConstructionRequest<'_>,
    metadata: &ProviderLaunchMetadata,
) -> Result<ProviderLaunch, ProviderError> {
    validate(request, true)?;
    let binary = request.executable.to_string_lossy().into_owned();
    let mut argv = match request.kind {
        ProviderLaunchKind::Fresh => {
            let mut argv = vec![binary, "--permission-mode".into(), "auto".into()];
            add_model_effort(&mut argv, request.options, "--effort")?;
            argv.push(request.prompt.unwrap_or_default().to_owned());
            argv
        }
        ProviderLaunchKind::Resume {
            provider_session_id,
        } => {
            validate_session(provider_session_id)?;
            vec![
                binary,
                "--permission-mode".into(),
                "auto".into(),
                "--resume".into(),
                provider_session_id.into(),
            ]
        }
    };
    let settings = provider_settings(metadata, request, true);
    argv.splice(
        1..1,
        [
            "--settings".into(),
            compact_json(&settings),
            "--mcp-config".into(),
            compact_json(&json!({"mcpServers": {"ticketry": request.mcp_server}})),
        ],
    );
    Ok(output(request, argv, None))
}

pub(crate) fn codex(
    request: &LaunchConstructionRequest<'_>,
    metadata: &ProviderLaunchMetadata,
) -> Result<ProviderLaunch, ProviderError> {
    validate(request, true)?;
    let binary = request.executable.to_string_lossy().into_owned();
    let mut argv = match request.kind {
        ProviderLaunchKind::Fresh => {
            let mut argv = vec![binary];
            add_codex_options(&mut argv, request.options)?;
            argv.push(request.prompt.unwrap_or_default().to_owned());
            argv
        }
        ProviderLaunchKind::Resume {
            provider_session_id,
        } => {
            validate_session(provider_session_id)?;
            let mut argv = vec![binary, "resume".into()];
            if let Some(profile) = request.options.profile {
                argv.extend(["--profile".into(), profile.into()]);
            }
            argv.push(provider_session_id.into());
            argv
        }
    };
    let settings = provider_settings(metadata, request, false);
    let injected = [
        "-c".into(),
        format!("hooks={}", toml_inline(&settings["hooks"])),
        "-c".into(),
        format!(
            "mcp_servers={}",
            toml_inline(&json!({"ticketry": request.mcp_server}))
        ),
        "-c".into(),
        "approvals_reviewer=\"auto_review\"".into(),
        "--dangerously-bypass-hook-trust".into(),
    ];
    let offset = usize::from(matches!(request.kind, ProviderLaunchKind::Resume { .. }));
    argv.splice(1 + offset..1 + offset, injected);
    Ok(output(request, argv, None))
}

pub(crate) fn gemini(
    request: &LaunchConstructionRequest<'_>,
    metadata: &ProviderLaunchMetadata,
) -> Result<ProviderLaunch, ProviderError> {
    validate(request, false)?;
    let binary = request.executable.to_string_lossy().into_owned();
    let mut argv = vec![
        binary,
        "--skip-trust".into(),
        "--approval-mode".into(),
        "yolo".into(),
    ];
    match request.kind {
        ProviderLaunchKind::Fresh => {
            add_model(&mut argv, request.options)?;
            argv.push(request.prompt.unwrap_or_default().into());
        }
        ProviderLaunchKind::Resume {
            provider_session_id,
        } => {
            validate_session(provider_session_id)?;
            argv.extend(["--resume".into(), provider_session_id.into()]);
        }
    }
    let settings = RuntimeSettings {
        environment_name: metadata
            .settings_environment
            .expect("Gemini settings environment"),
        contents: provider_settings(metadata, request, false),
    };
    Ok(output(request, argv, Some(settings)))
}

pub(crate) fn agy(
    request: &LaunchConstructionRequest<'_>,
    metadata: &ProviderLaunchMetadata,
) -> Result<ProviderLaunch, ProviderError> {
    validate(request, false)?;
    let binary = request.executable.to_string_lossy().into_owned();
    let mut argv = vec![binary, "--dangerously-skip-permissions".into()];
    match request.kind {
        ProviderLaunchKind::Fresh => {
            add_model(&mut argv, request.options)?;
            argv.extend(["-i".into(), request.prompt.unwrap_or_default().into()]);
        }
        ProviderLaunchKind::Resume {
            provider_session_id,
        } => {
            validate_session(provider_session_id)?;
            argv.extend(["--conversation".into(), provider_session_id.into()]);
        }
    }
    let settings = RuntimeSettings {
        environment_name: metadata
            .settings_environment
            .expect("Agy settings environment"),
        contents: provider_settings(metadata, request, false),
    };
    Ok(output(request, argv, Some(settings)))
}

fn validate(
    request: &LaunchConstructionRequest<'_>,
    supports_effort: bool,
) -> Result<(), ProviderError> {
    validate_identifier(request.options.profile, ProviderErrorCode::InvalidProfile)?;
    validate_identifier(request.options.model, ProviderErrorCode::UnsupportedModel)?;
    validate_identifier(request.options.effort, ProviderErrorCode::UnsupportedEffort)?;
    if request.options.effort.is_some() && !supports_effort {
        return Err(ProviderError::new(
            ProviderErrorCode::UnsupportedEffort,
            "This provider does not support effort overrides.",
        ));
    }
    if request.agent_run_id.is_empty() || !request.working_directory.is_absolute() {
        return Err(ProviderError::new(
            ProviderErrorCode::InvalidLaunchInput,
            "Provider launch authority is incomplete.",
        ));
    }
    Ok(())
}

fn validate_identifier(value: Option<&str>, code: ProviderErrorCode) -> Result<(), ProviderError> {
    if value.is_some_and(|value| {
        value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._:/-".contains(&byte))
    }) {
        Err(ProviderError::new(
            code,
            "Provider options must be non-empty identifiers.",
        ))
    } else {
        Ok(())
    }
}

fn validate_session(value: &str) -> Result<(), ProviderError> {
    if value.is_empty() {
        Err(ProviderError::new(
            ProviderErrorCode::InvalidResumeIdentity,
            "Provider session identity must be non-empty.",
        ))
    } else {
        Ok(())
    }
}

fn add_model(argv: &mut Vec<String>, options: ProviderOptions<'_>) -> Result<(), ProviderError> {
    if options.profile.is_some() {
        return Err(ProviderError::new(
            ProviderErrorCode::UnsupportedProfile,
            "This provider does not support launch profiles.",
        ));
    }
    if let Some(model) = options.model {
        argv.extend(["--model".into(), model.into()]);
    }
    Ok(())
}

fn add_model_effort(
    argv: &mut Vec<String>,
    options: ProviderOptions<'_>,
    effort_flag: &str,
) -> Result<(), ProviderError> {
    add_model(
        argv,
        ProviderOptions {
            profile: None,
            ..options
        },
    )?;
    if options.profile.is_some() {
        return Err(ProviderError::new(
            ProviderErrorCode::UnsupportedProfile,
            "This provider does not support launch profiles.",
        ));
    }
    if let Some(effort) = options.effort {
        argv.extend([effort_flag.into(), effort.into()]);
    }
    Ok(())
}

fn add_codex_options(
    argv: &mut Vec<String>,
    options: ProviderOptions<'_>,
) -> Result<(), ProviderError> {
    if let Some(profile) = options.profile {
        argv.extend(["--profile".into(), profile.into()]);
        return Ok(());
    }
    if let Some(model) = options.model {
        argv.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = options.effort {
        argv.extend(["-c".into(), format!("model_reasoning_effort=\"{effort}\"")]);
    }
    Ok(())
}

fn provider_settings(
    metadata: &ProviderLaunchMetadata,
    request: &LaunchConstructionRequest<'_>,
    claude: bool,
) -> Value {
    let hook = json!({"hooks": [{"type": "command", "command": request.hook_command, "timeout": metadata.hook_timeout}]});
    let hooks = metadata
        .hook_events
        .iter()
        .map(|event| ((*event).to_owned(), json!([hook.clone()])))
        .collect::<Map<_, _>>();
    if claude {
        json!({"env": {"MUXED_AGENT_RUN_ID": request.agent_run_id}, "hooks": hooks})
    } else if metadata.settings_environment.is_some() {
        json!({"hooks": hooks, "mcpServers": {"ticketry": request.mcp_server}})
    } else {
        json!({"hooks": hooks})
    }
}

fn output(
    request: &LaunchConstructionRequest<'_>,
    argv: Vec<String>,
    settings: Option<RuntimeSettings>,
) -> ProviderLaunch {
    ProviderLaunch {
        argv,
        working_directory: request.working_directory.to_path_buf(),
        settings,
    }
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).expect("provider settings are JSON")
}

fn toml_inline(value: &Value) -> String {
    match value {
        Value::Object(values) => format!(
            "{{{}}}",
            values
                .iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, value)| format!("{key}={}", toml_inline(value)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(toml_inline).collect::<Vec<_>>().join(",")
        ),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(_) => compact_json(value).replace('\u{7f}', "\\u007f"),
        Value::Null => "\"\"".into(),
    }
}
