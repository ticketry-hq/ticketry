use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use ticketry_provider::{
    LaunchConstructionRequest, ProviderError, ProviderErrorCode, ProviderLaunchKind,
    ProviderOptions as SharedProviderOptions,
};

use super::provider::provider_contract;
use ticketry_diagnostics as trace;

use super::types::LAUNCH_MATERIAL_VERSION;
use super::{
    DurableLaunchMaterial, LaunchKind, LaunchPlanningError, LaunchPlanningErrorCode,
    MaterializedLaunch, Provider, RuntimeSettings,
};
use crate::trace_reasons;

/// Values supplied only by trusted desktop services immediately before tmux
/// creation. This value is intentionally not serializable or deserializable.
#[derive(Clone)]
pub struct ExecutionAuthority {
    executable: PathBuf,
    working_directory: PathBuf,
    hook_runner: PathBuf,
    hook_spool_directory: PathBuf,
    mcp_data_directory: PathBuf,
    mcp_authorization: String,
    available_skills: BTreeSet<String>,
    registered_profiles: Vec<String>,
}

impl std::fmt::Debug for ExecutionAuthority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutionAuthority").finish_non_exhaustive()
    }
}

impl ExecutionAuthority {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        executable: PathBuf,
        working_directory: PathBuf,
        hook_runner: PathBuf,
        hook_spool_directory: PathBuf,
        mcp_data_directory: PathBuf,
        mcp_authorization: String,
        available_skills: BTreeSet<String>,
        registered_profiles: Vec<String>,
    ) -> Self {
        Self {
            executable,
            working_directory,
            hook_runner,
            hook_spool_directory,
            mcp_data_directory,
            mcp_authorization,
            available_skills,
            registered_profiles,
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
            trace::PROVIDER_VALIDATED
        } else {
            trace::ARGV_MATERIALISED
        };
        trace::refused(stage, trace_reasons::planning_reason(error.code)).record();
    } else if let Ok(launch) = &outcome {
        trace::admitted(trace::ARGV_MATERIALISED)
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
    let hook = hook_command(durable.provider, &durable.agent_run_id, authority);
    let launch_kind = match &durable.kind {
        LaunchKind::Resume {
            provider_session_id,
        } => ProviderLaunchKind::Resume {
            provider_session_id,
        },
        _ => ProviderLaunchKind::Fresh,
    };
    let launch = ticketry_provider::provider_contract(durable.provider)
        .construct_launch(&LaunchConstructionRequest {
            executable: &authority.executable,
            working_directory: &authority.working_directory,
            kind: launch_kind,
            agent_run_id: &durable.agent_run_id,
            prompt: durable.prompt.as_deref(),
            options: SharedProviderOptions {
                profile: durable.options.profile.as_deref(),
                model: durable.options.model.as_deref(),
                effort: durable.options.reasoning.as_deref(),
            },
            registered_profiles: &authority.registered_profiles,
            hook_command: &hook,
            mcp_server: mcp_server(durable.provider, &durable.agent_run_id, authority),
        })
        .map_err(map_provider_error)?;
    trace::admitted(trace::PROVIDER_VALIDATED)
        .with("providerSlug", provider_contract(durable.provider).slug)
        .record();
    validate_authority(durable, authority)?;
    for skill in &durable.required_skills {
        if !authority.available_skills.contains(skill) {
            return Err(LaunchPlanningError::new(
                LaunchPlanningErrorCode::RequiredSkillUnavailable,
                format!("Required skill '{skill}' is unavailable for this invocation."),
            ));
        }
    }

    let environment = BTreeMap::from([
        ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ("FORCE_COLOR".to_owned(), "1".to_owned()),
        (
            "TICKETRY_MCP_AUTHORIZATION".to_owned(),
            authority.mcp_authorization.clone(),
        ),
    ]);
    Ok(MaterializedLaunch {
        argv: launch.argv,
        working_directory: launch.working_directory,
        environment,
        settings: launch.settings.map(|settings| RuntimeSettings {
            environment_name: settings.environment_name,
            contents: settings.contents,
        }),
    })
}

fn map_provider_error(error: ProviderError) -> LaunchPlanningError {
    let code = match error.code {
        ProviderErrorCode::UnknownProvider => LaunchPlanningErrorCode::UnknownProvider,
        ProviderErrorCode::UnsupportedEffort => LaunchPlanningErrorCode::UnsupportedReasoning,
        ProviderErrorCode::InvalidResumeIdentity => LaunchPlanningErrorCode::InvalidResumeIdentity,
        ProviderErrorCode::InvalidLaunchInput => LaunchPlanningErrorCode::InvalidExecutionAuthority,
        ProviderErrorCode::UnsupportedProfile
        | ProviderErrorCode::InvalidProfile
        | ProviderErrorCode::UnregisteredProfile
        | ProviderErrorCode::ProfileConflict
        | ProviderErrorCode::UnsupportedModel => LaunchPlanningErrorCode::UnsupportedModel,
    };
    LaunchPlanningError::new(code, error.message)
}

fn validate_authority(
    durable: &DurableLaunchMaterial,
    authority: &ExecutionAuthority,
) -> Result<(), LaunchPlanningError> {
    let expected = provider_contract(durable.provider).slug;
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
        || !authority.mcp_data_directory.is_absolute()
        || authority.mcp_authorization.is_empty()
        || durable.agent_run_id.is_empty()
    {
        return Err(LaunchPlanningError::new(
            LaunchPlanningErrorCode::InvalidExecutionAuthority,
            "Trusted execution authority is incomplete.",
        ));
    }
    Ok(())
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

fn mcp_server(provider: Provider, run_id: &str, authority: &ExecutionAuthority) -> Value {
    let mut server = json!({
        "command": authority.hook_runner,
        "args": ["mcp", "--data-dir", authority.mcp_data_directory, "--agent-run-id", run_id],
    });
    if provider == Provider::Codex {
        server["env_vars"] = json!(["TICKETRY_MCP_AUTHORIZATION"]);
        server["required"] = json!(true);
    } else {
        server["env"] = json!({"TICKETRY_MCP_AUTHORIZATION": "${TICKETRY_MCP_AUTHORIZATION}"});
    }
    if matches!(provider, Provider::Gemini | Provider::Agy) {
        server["trust"] = json!(true);
    }
    server
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
