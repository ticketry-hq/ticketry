use std::{fs, io, path::PathBuf};

use toml_edit::{DocumentMut, InlineTable, Value};

use crate::CodexAppServerError;

/// Disable only existing user entries, retaining their valid transport and the
/// original CODEX_HOME used for authentication and saved thread-title reads.
/// These highest-precedence overrides apply to the configuration observed at
/// spawn; this resident helper never starts or resumes a thread.
pub(crate) fn user_mcp_override() -> Result<Option<String>, CodexAppServerError> {
    let config_path = match std::env::var_os("CODEX_HOME").filter(|path| !path.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => std::env::home_dir()
            .ok_or_else(|| unsafe_config("cannot determine Codex home"))?
            .join(".codex"),
    }
    .join("config.toml");
    if !config_path.is_absolute() {
        return Err(unsafe_config("Codex home must be absolute"));
    }
    let contents = match fs::read_to_string(config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(unsafe_config("cannot read user configuration")),
    };
    let document = contents
        .parse::<DocumentMut>()
        .map_err(|_| unsafe_config("cannot parse user configuration"))?;
    let Some(servers) = document.get("mcp_servers") else {
        return Ok(None);
    };
    let servers = servers
        .as_table_like()
        .ok_or_else(|| unsafe_config("MCP servers must be a table"))?;
    let mut disabled = InlineTable::new();
    for (name, server) in servers.iter() {
        if server.as_table_like().is_none() {
            return Err(unsafe_config("MCP server entry must be a table"));
        }
        let mut entry = InlineTable::new();
        entry.insert("enabled", Value::from(false));
        disabled.insert(name, Value::InlineTable(entry));
    }
    Ok((!disabled.is_empty()).then(|| format!("mcp_servers={disabled}")))
}

fn unsafe_config(reason: &str) -> CodexAppServerError {
    // TOML parse errors can include user secrets; report only the safe reason.
    CodexAppServerError::unavailable(format!("codex app-server MCP isolation: {reason}"))
}
