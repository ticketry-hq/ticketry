use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::provider::{provider_contract, validate_options};
use ticketry_diagnostics::launch_trace as trace;

use super::types::LAUNCH_MATERIAL_VERSION;
use super::{
    DurableLaunchMaterial, LaunchKind, LaunchPlanningError, LaunchPlanningErrorCode,
    MaterializedLaunch, Provider, RuntimeSettings,
};
use crate::launch::trace_reasons;

/// Values supplied only by trusted desktop services immediately before tmux
/// creation. This value is intentionally not serializable or deserializable.
#[derive(Clone, Debug)]
pub struct ExecutionAuthority {
    executable: PathBuf,
    working_directory: PathBuf,
    hook_runner: PathBuf,
    hook_spool_directory: PathBuf,
    mcp_url: String,
    mcp_authorization: String,
    available_skills: BTreeSet<String>,
}

impl ExecutionAuthority {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        executable: PathBuf,
        working_directory: PathBuf,
        hook_runner: PathBuf,
        hook_spool_directory: PathBuf,
        mcp_url: String,
        mcp_authorization: String,
        available_skills: BTreeSet<String>,
    ) -> Self {
        Self {
            executable,
            working_directory,
            hook_runner,
            hook_spool_directory,
            mcp_url,
            mcp_authorization,
            available_skills,
        }
    }
}

/// Materialises one launch's argv.
///
/// Both the provider-validation stage and the argv stage are observed here,
/// because this is the one seam both run in. The trace records argv by its
/// shape — never its values.
pub fn materialize(
    durable: &DurableLaunchMaterial,
    authority: &ExecutionAuthority,
) -> Result<MaterializedLaunch, LaunchPlanningError> {
    let outcome = materialize_inner(durable, authority);
    if let Err(error) = &outcome {
        let stage = if matches!(
            error.code,
            LaunchPlanningErrorCode::UnknownProvider
                | LaunchPlanningErrorCode::UnsupportedModel
                | LaunchPlanningErrorCode::UnsupportedReasoning
                | LaunchPlanningErrorCode::UnsupportedVersion
        ) {
            trace::stages::PROVIDER_VALIDATED
        } else {
            trace::stages::ARGV_MATERIALISED
        };
        trace::refused(stage, trace_reasons::planning_reason(error.code)).record();
    } else if let Ok(launch) = &outcome {
        trace::admitted(trace::stages::ARGV_MATERIALISED)
            .with("argumentCount", launch.argv.len())
            .with("hasRuntimeSettings", launch.settings.is_some())
            .record();
    }
    outcome
}

fn materialize_inner(
    durable: &DurableLaunchMaterial,
    authority: &ExecutionAuthority,
) -> Result<MaterializedLaunch, LaunchPlanningError> {
    if durable.version != LAUNCH_MATERIAL_VERSION {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::UnsupportedVersion,
            format!(
                "Launch material version {} is unsupported.",
                durable.version
            ),
        ));
    }
    validate_options(durable.provider, &durable.options)?;
    trace::admitted(trace::stages::PROVIDER_VALIDATED)
        .with("providerSlug", provider_contract(durable.provider).slug)
        .record();
    validate_authority(durable.provider, authority)?;
    for skill in &durable.required_skills {
        if !authority.available_skills.contains(skill) {
            return Err(LaunchPlanningError::new(
                LaunchPlanningErrorCode::RequiredSkillUnavailable,
                format!("Required skill '{skill}' is unavailable for this invocation."),
            ));
        }
    }

    let mut argv = provider_argv(durable, &authority.executable)?;
    let hook = hook_command(durable.provider, &durable.agent_run_id, authority);
    let settings = provider_settings(durable.provider, &durable.agent_run_id, &hook, authority);
    let runtime_settings = match durable.provider {
        Provider::Claude => {
            let mcp = claude_mcp(authority);
            argv.splice(
                1..1,
                [
                    "--settings".to_owned(),
                    compact_json(&settings),
                    "--mcp-config".to_owned(),
                    compact_json(&mcp),
                ],
            );
            None
        }
        Provider::Codex => {
            let hooks = toml_inline(&settings["hooks"]);
            let mcp = toml_inline(&codex_mcp(authority));
            let injected = [
                "-c".to_owned(),
                format!("hooks={hooks}"),
                "-c".to_owned(),
                format!("mcp_servers={mcp}"),
                "-c".to_owned(),
                "approvals_reviewer=\"auto_review\"".to_owned(),
                "--dangerously-bypass-hook-trust".to_owned(),
            ];
            let offset = usize::from(matches!(durable.kind, LaunchKind::Resume { .. }));
            argv.splice(1 + offset..1 + offset, injected);
            None
        }
        Provider::Gemini | Provider::Agy => Some(RuntimeSettings {
            environment_name: "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
            contents: settings,
        }),
    };

    let environment = BTreeMap::from([
        ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ("FORCE_COLOR".to_owned(), "1".to_owned()),
    ]);
    Ok(MaterializedLaunch {
        argv,
        working_directory: authority.working_directory.clone(),
        environment,
        settings: runtime_settings,
    })
}

fn validate_authority(
    provider: Provider,
    authority: &ExecutionAuthority,
) -> Result<(), LaunchPlanningError> {
    let expected = provider_contract(provider).slug;
    if !authority.executable.is_absolute()
        || authority
            .executable
            .file_name()
            .and_then(|value| value.to_str())
            != Some(expected)
    {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::ExecutableUnavailable,
            format!("The approved {expected} executable is unavailable."),
        ));
    }
    if !authority.working_directory.is_absolute()
        || !authority.hook_runner.is_absolute()
        || !authority.hook_spool_directory.is_absolute()
        || authority.mcp_url.is_empty()
        || authority.mcp_authorization.is_empty()
    {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::InvalidExecutionAuthority,
            "Trusted execution authority is incomplete.",
        ));
    }
    Ok(())
}

fn provider_argv(
    durable: &DurableLaunchMaterial,
    executable: &Path,
) -> Result<Vec<String>, LaunchPlanningError> {
    let binary = executable.to_string_lossy().into_owned();
    if let LaunchKind::Resume {
        provider_session_id,
    } = &durable.kind
    {
        if provider_session_id.is_empty() {
            return Err(LaunchPlanningError::new(
                LaunchPlanningErrorCode::InvalidResumeIdentity,
                "Provider session identity must be non-empty.",
            ));
        }
        return Ok(match durable.provider {
            Provider::Claude => vec![
                binary,
                "--permission-mode".into(),
                "auto".into(),
                "--resume".into(),
                provider_session_id.clone(),
            ],
            Provider::Codex => vec![binary, "resume".into(), provider_session_id.clone()],
            Provider::Gemini => vec![
                binary,
                "--skip-trust".into(),
                "--approval-mode".into(),
                "yolo".into(),
                "--resume".into(),
                provider_session_id.clone(),
            ],
            Provider::Agy => vec![
                binary,
                "--dangerously-skip-permissions".into(),
                "--conversation".into(),
                provider_session_id.clone(),
            ],
        });
    }
    let prompt = durable.prompt.clone().unwrap_or_default();
    let mut options = Vec::new();
    if let Some(model) = &durable.options.model {
        options.extend(["--model".to_owned(), model.clone()]);
    }
    if let Some(reasoning) = &durable.options.reasoning {
        match durable.provider {
            Provider::Claude => options.extend(["--effort".to_owned(), reasoning.clone()]),
            Provider::Codex => options.extend([
                "-c".to_owned(),
                format!("model_reasoning_effort=\"{reasoning}\""),
            ]),
            Provider::Gemini | Provider::Agy => unreachable!("validated above"),
        }
    }
    Ok(match durable.provider {
        Provider::Claude => [
            vec![binary, "--permission-mode".into(), "auto".into()],
            options,
            vec![prompt],
        ]
        .concat(),
        Provider::Codex => [vec![binary], options, vec![prompt]].concat(),
        Provider::Gemini => [
            vec![
                binary,
                "--skip-trust".into(),
                "--approval-mode".into(),
                "yolo".into(),
            ],
            options,
            vec![prompt],
        ]
        .concat(),
        Provider::Agy => [
            vec![binary, "--dangerously-skip-permissions".into()],
            options,
            vec!["-i".into(), prompt],
        ]
        .concat(),
    })
}

fn hook_command(provider: Provider, run_id: &str, authority: &ExecutionAuthority) -> String {
    let mut args = vec![
        authority.hook_runner.to_string_lossy().into_owned(),
        "hook".into(),
        provider_contract(provider).slug.into(),
        "--spool-dir".into(),
        authority
            .hook_spool_directory
            .to_string_lossy()
            .into_owned(),
    ];
    if provider != Provider::Claude {
        args.extend(["--agent-run-id".into(), run_id.into()]);
    }
    shell_join(&args)
}

fn provider_settings(
    provider: Provider,
    run_id: &str,
    hook: &str,
    authority: &ExecutionAuthority,
) -> Value {
    let contract = provider_contract(provider);
    let hook_entry = json!({
        "hooks": [{"type": "command", "command": hook, "timeout": contract.hook_timeout}]
    });
    let hooks = contract
        .hook_events
        .iter()
        .map(|event| ((*event).to_owned(), json!([hook_entry.clone()])))
        .collect::<Map<_, _>>();
    match provider {
        Provider::Claude => json!({
            "env": {
                "MUXED_AGENT_RUN_ID": run_id,
            },
            "hooks": hooks,
        }),
        Provider::Codex => json!({"hooks": hooks}),
        Provider::Gemini | Provider::Agy => json!({
            "hooks": hooks,
            "mcpServers": gemini_mcp(authority),
        }),
    }
}

fn claude_mcp(authority: &ExecutionAuthority) -> Value {
    json!({"mcpServers": {"worktracker-agent": {
        "type": "http", "url": authority.mcp_url,
        "headers": {"Authorization": authority.mcp_authorization}
    }}})
}

fn codex_mcp(authority: &ExecutionAuthority) -> Value {
    json!({"worktracker-agent": {
        "url": authority.mcp_url,
        "http_headers": {"Authorization": authority.mcp_authorization}
    }})
}

fn gemini_mcp(authority: &ExecutionAuthority) -> Value {
    json!({"worktracker-agent": {
        "httpUrl": authority.mcp_url, "trust": true,
        "headers": {"Authorization": authority.mcp_authorization}
    }})
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
        Value::String(value) => format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"")),
        Value::Null => "\"\"".to_owned(),
    }
}

fn shell_join(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|argument| {
            if argument
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_@%+=:,./-".contains(&byte))
            {
                argument.clone()
            } else {
                format!("'{}'", argument.replace('\'', "'\"'\"'"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
