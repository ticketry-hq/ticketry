use crate::{Provider, ProviderError, ProviderErrorCode, ProviderOptions};
use std::path::Path;

pub struct ExecConstructionRequest<'a> {
    pub provider: Provider,
    pub options: ProviderOptions<'a>,
    pub schema: &'a Path,
    pub result: &'a Path,
}

pub fn construct_exec(request: ExecConstructionRequest<'_>) -> Result<Vec<String>, ProviderError> {
    if request.provider != Provider::Codex {
        return Err(ProviderError::new(ProviderErrorCode::InvalidLaunchInput,
            "This provider does not support typed sprint execution yet. Choose a Codex default in Settings."));
    }
    let mut argv = vec![
        "exec".into(),
        "--ephemeral".into(),
        "--ignore-user-config".into(),
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--color".into(),
        "never".into(),
        "--output-schema".into(),
        request.schema.to_string_lossy().into_owned(),
        "--output-last-message".into(),
        request.result.to_string_lossy().into_owned(),
    ];
    if let Some(profile) = request.options.profile {
        argv.extend(["--profile".into(), profile.into()]);
    } else {
        if let Some(model) = request.options.model {
            argv.extend(["--model".into(), model.into()]);
        }
        if let Some(effort) = request.options.effort {
            argv.extend([
                "-c".into(),
                format!(
                    "model_reasoning_effort={}",
                    serde_json::to_string(effort).unwrap()
                ),
            ]);
        }
    }
    // Override any profile's MCP configuration: this execution only returns data.
    argv.extend([
        "-c".into(),
        "mcp_servers={}".into(),
        "-c".into(),
        "hooks={}".into(),
        "-".into(),
    ]);
    Ok(argv)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_exec_has_typed_output_and_no_ticketry_tool_or_hook_configuration() {
        let args = construct_exec(ExecConstructionRequest {
            provider: Provider::Codex,
            options: ProviderOptions {
                model: Some("model"),
                effort: Some("high"),
                profile: None,
            },
            schema: Path::new("schema.json"),
            result: Path::new("result.json"),
        })
        .unwrap();
        assert_eq!(args[0], "exec");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output-schema", "schema.json"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output-last-message", "result.json"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args.iter().any(|arg| arg == "mcp_servers={}"));
        assert!(args.iter().any(|arg| arg == "hooks={}"));
        assert!(construct_exec(ExecConstructionRequest {
            provider: Provider::Claude,
            options: ProviderOptions::default(),
            schema: Path::new("schema.json"),
            result: Path::new("result.json")
        })
        .is_err());
    }
}
