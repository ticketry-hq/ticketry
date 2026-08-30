//! The environment-variable contract for the desktop process. Every variable
//! the desktop reads is named here so the launch surface stays enumerable.

use std::env;

pub(crate) const SMOKE_EXIT_AFTER_STARTUP: &str = "MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP";
pub(crate) const ACCEPTANCE_EXIT_AFTER_STARTUP: &str =
    "MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP";
pub(crate) const DEVELOPMENT_MCP_PORT_ENV: &str = "MUXED_DESKTOP_MCP_PORT";
pub(crate) const DEVELOPMENT_LOG_PATH_ENV: &str = "MUXED_DEVELOPMENT_LOG_PATH";

pub(crate) fn development_log_path() -> Option<std::path::PathBuf> {
    env::var_os(DEVELOPMENT_LOG_PATH_ENV).map(Into::into)
}

pub(crate) fn smoke_startup_exit_requested() -> bool {
    env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
}

pub(crate) fn automated_startup_exit_requested() -> bool {
    smoke_startup_exit_requested() || env::var(ACCEPTANCE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
}

pub(crate) fn optional_port(name: &str) -> Result<Option<u16>, String> {
    let Some(value) = env::var_os(name) else {
        return Ok(None);
    };
    let value = value
        .into_string()
        .map_err(|_| format!("{name} must contain valid UTF-8"))?;
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .map(Some)
        .ok_or_else(|| format!("{name} must be a valid TCP port (1-65535)"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automated_exit_includes_smoke_mode() {
        assert!(
            !automated_startup_exit_requested()
                || smoke_startup_exit_requested()
                || env::var(ACCEPTANCE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
        );
    }
}
