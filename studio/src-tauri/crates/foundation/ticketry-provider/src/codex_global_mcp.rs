use std::{fs, io, path::Path};

use toml_edit::{value, Array, DocumentMut, Item, Table};

use crate::{
    global_mcp::provider_installed,
    trust::{
        codex_config_file, read_codex_document, write_codex_configuration, CodexDirectoryLock,
    },
    GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};

/// Ensure Codex's user-scope `ticketry` MCP server is registered.
pub fn register_codex_global_mcp(
    context: GlobalMcpRegistrationContext<'_>,
) -> GlobalMcpRegistrationOutcome {
    register(context).unwrap_or_else(|error| GlobalMcpRegistrationOutcome::Failed {
        diagnostic: match error.kind() {
            io::ErrorKind::WouldBlock => "locked",
            io::ErrorKind::InvalidData | io::ErrorKind::InvalidInput => "invalid_state",
            _ => "registration_failed",
        }
        .into(),
    })
}

fn register(context: GlobalMcpRegistrationContext<'_>) -> io::Result<GlobalMcpRegistrationOutcome> {
    absolute_utf8(context.hook_runner)?;
    absolute_utf8(context.data_directory)?;
    let config = codex_config_file(context.config_file)?;
    let parent = config
        .parent()
        .filter(|_| config.file_name().is_some())
        .ok_or_else(|| invalid("configuration_path_unavailable"))?;
    if !config.exists() && !provider_installed("codex", context.executable) {
        return Ok(GlobalMcpRegistrationOutcome::Skipped {
            reason: "provider_not_installed".into(),
        });
    }
    fs::create_dir_all(parent)?;
    let _lock = CodexDirectoryLock::acquire(&config)?;
    if fs::symlink_metadata(&config).is_ok_and(|metadata| metadata.permissions().readonly()) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "configuration_read_only",
        ));
    }
    let (before, _) = read_codex_document(&config)?;
    let (after, outcome) = edit(&before, context)?;
    if before == after {
        return Ok(outcome);
    }
    write_codex_configuration(&config, |source| edit(source, context))
}

fn edit(
    source: &[u8],
    context: GlobalMcpRegistrationContext<'_>,
) -> io::Result<(Vec<u8>, GlobalMcpRegistrationOutcome)> {
    let mut document = std::str::from_utf8(source)
        .map_err(|_| invalid("invalid_state"))?
        .parse::<DocumentMut>()
        .map_err(|_| invalid("invalid_state"))?;
    if !document.contains_key("mcp_servers") {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    let servers = document["mcp_servers"]
        .as_table_like_mut()
        .ok_or_else(|| invalid("invalid_state"))?;
    let existed = servers.contains_key("ticketry");
    if servers
        .get("ticketry")
        .is_some_and(|entry| !is_ticketry_owned(entry))
    {
        return Ok((
            source.to_vec(),
            GlobalMcpRegistrationOutcome::Skipped {
                reason: "foreign_entry".into(),
            },
        ));
    }
    if servers
        .get("ticketry")
        .and_then(Item::as_table_like)
        .is_some_and(|entry| {
            entry.len() == 2
                && entry.get("command").and_then(Item::as_str) == context.hook_runner.to_str()
                && entry
                    .get("args")
                    .and_then(Item::as_array)
                    .is_some_and(|args| {
                        args.len() == 4
                            && args.iter().filter_map(|arg| arg.as_str()).eq([
                                "mcp",
                                "--data-dir",
                                context.data_directory.to_str().unwrap_or(""),
                                "--global",
                            ])
                    })
        })
    {
        return Ok((source.to_vec(), GlobalMcpRegistrationOutcome::Unchanged));
    }
    if !existed {
        servers.insert("ticketry", Item::Table(Table::new()));
    }
    let entry = servers
        .get_mut("ticketry")
        .unwrap()
        .as_table_like_mut()
        .unwrap();
    let extras: Vec<_> = entry
        .iter()
        .filter(|(key, _)| !matches!(*key, "command" | "args"))
        .map(|(key, _)| key.to_owned())
        .collect();
    for key in extras {
        entry.remove(&key);
    }
    let command = value(absolute_utf8(context.hook_runner)?);
    let args: Array = [
        "mcp",
        "--data-dir",
        absolute_utf8(context.data_directory)?,
        "--global",
    ]
    .into_iter()
    .collect();
    for (key, mut replacement) in [("command", command), ("args", value(args))] {
        if let Some(existing) = entry.get_mut(key) {
            if let (Some(before), Some(after)) = (existing.as_value(), replacement.as_value_mut()) {
                *after.decor_mut() = before.decor().clone();
            }
            *existing = replacement;
        } else {
            entry.insert(key, replacement);
        }
    }
    Ok((
        document.to_string().into_bytes(),
        if existed {
            GlobalMcpRegistrationOutcome::Updated
        } else {
            GlobalMcpRegistrationOutcome::Registered
        },
    ))
}

fn absolute_utf8(path: &Path) -> io::Result<&str> {
    if !path.is_absolute() {
        return Err(invalid("invalid_paths"));
    }
    path.to_str().ok_or_else(|| invalid("invalid_paths"))
}

fn is_ticketry_owned(entry: &Item) -> bool {
    let Some(entry) = entry.as_table_like() else {
        return false;
    };
    entry
        .get("command")
        .and_then(Item::as_str)
        .is_some_and(|command| {
            Path::new(command)
                .file_name()
                .is_some_and(|name| name == "ticketry-hook")
        })
        && entry
            .get("args")
            .and_then(Item::as_array)
            .is_some_and(|args| {
                args.iter().any(|arg| arg.as_str() == Some("mcp"))
                    && args.iter().any(|arg| arg.as_str() == Some("--global"))
            })
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
