use std::{fs, io::ErrorKind, path::Path};

use crate::claude_state::{read_state, state_file, write_state, DirectoryLock};

/// Paths needed to register a user-scope WorkTracker MCP server.
#[derive(Clone, Copy, Debug)]
pub struct GlobalMcpRegistrationContext<'a> {
    pub hook_runner: &'a Path,
    pub data_directory: &'a Path,
    pub config_file: Option<&'a Path>,
    pub executable: Option<&'a Path>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GlobalMcpRegistrationOutcome {
    Registered,
    Updated,
    Unchanged,
    Skipped { reason: String },
    Failed { diagnostic: String },
}

/// Ensure Claude's user-scope `ticketry` MCP server is registered.
pub fn register_claude_global_mcp(
    context: GlobalMcpRegistrationContext<'_>,
) -> GlobalMcpRegistrationOutcome {
    register(context).unwrap_or_else(|diagnostic| GlobalMcpRegistrationOutcome::Failed {
        diagnostic: diagnostic.into(),
    })
}

fn register(
    context: GlobalMcpRegistrationContext<'_>,
) -> Result<GlobalMcpRegistrationOutcome, &'static str> {
    let hook_runner = absolute_utf8(context.hook_runner)?;
    let data_directory = absolute_utf8(context.data_directory)?;
    let config = state_file(context.config_file).map_err(|_| "configuration_path_unavailable")?;
    let parent = config.parent().ok_or("configuration_path_unavailable")?;
    if !config.exists() && !provider_installed("claude", context.executable) {
        return Ok(GlobalMcpRegistrationOutcome::Skipped {
            reason: "provider_not_installed".into(),
        });
    }
    fs::create_dir_all(parent).map_err(|_| "write_failed")?;
    let _lock = DirectoryLock::acquire(&config).map_err(|error| {
        if error.kind() == ErrorKind::WouldBlock {
            "locked"
        } else {
            "write_failed"
        }
    })?;
    let (before, mut state) = read_state(&config).map_err(|error| {
        if matches!(
            error.kind(),
            ErrorKind::InvalidData | ErrorKind::InvalidInput
        ) {
            "invalid_state"
        } else {
            "state_read_failed"
        }
    })?;
    if state
        .get("mcpServers")
        .is_some_and(|servers| !servers.is_object())
    {
        return Err("invalid_state");
    }
    let entry = serde_json::json!({
        "command": hook_runner,
        "args": ["mcp", "--data-dir", data_directory, "--global"]
    });
    let existing = state
        .get("mcpServers")
        .and_then(|servers| servers.get("ticketry"));
    if existing.is_some_and(|entry| !is_ticketry_owned(entry)) {
        return Ok(GlobalMcpRegistrationOutcome::Skipped {
            reason: "foreign_entry".into(),
        });
    }
    if state
        .get("mcpServers")
        .and_then(|servers| servers.get("ticketry"))
        == Some(&entry)
    {
        return Ok(GlobalMcpRegistrationOutcome::Unchanged);
    }
    let existed = state
        .get("mcpServers")
        .and_then(|servers| servers.get("ticketry"))
        .is_some();
    let servers = state
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    servers
        .as_object_mut()
        .unwrap()
        .insert("ticketry".into(), entry);
    let contents = serde_json::to_vec_pretty(&state).map_err(|_| "invalid_state")?;
    write_state(&config, &before, &contents).map_err(|error| {
        if error.kind() == ErrorKind::WouldBlock {
            "state_changed"
        } else {
            "write_failed"
        }
    })?;
    Ok(if existed {
        GlobalMcpRegistrationOutcome::Updated
    } else {
        GlobalMcpRegistrationOutcome::Registered
    })
}

fn absolute_utf8(path: &Path) -> Result<&str, &'static str> {
    if !path.is_absolute() {
        return Err("invalid_paths");
    }
    path.to_str().ok_or("invalid_paths")
}

fn is_ticketry_owned(entry: &serde_json::Value) -> bool {
    let command_matches = entry
        .get("command")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|command| {
            Path::new(command)
                .file_name()
                .is_some_and(|name| name == "ticketry-hook")
        });
    let args_match = entry
        .get("args")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|args| {
            args.iter().any(|arg| arg == "mcp") && args.iter().any(|arg| arg == "--global")
        });
    command_matches && args_match
}

pub(crate) fn provider_installed(name: &str, executable: Option<&Path>) -> bool {
    if let Some(executable) = executable {
        return is_executable(executable);
    }
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|directory| is_executable(&directory.join(name)))
    })
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
