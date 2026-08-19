//! The environment-variable contract for the desktop process. Every variable
//! the desktop reads is named here so the launch surface stays enumerable.

use std::env::{self, VarError};

pub(crate) const SMOKE_EXIT_AFTER_STARTUP: &str = "MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP";
pub(crate) const SMOKE_SIDECAR_BINARY: &str = "MUXED_DESKTOP_SMOKE_SIDECAR_BINARY";
pub(crate) const PACKAGED_HOOK_RUNNER_ENV: &str = "MUXED_PACKAGED_HOOK_RUNNER";
pub(crate) const DEVELOPMENT_BACKEND_PORT_ENV: &str = "MUXED_DESKTOP_BACKEND_PORT";
pub(crate) const DEVELOPMENT_MCP_PORT_ENV: &str = "MUXED_DESKTOP_MCP_PORT";

/// The packaging smoke test drives a real launch and exits once the webview
/// has loaded. It is the only path that may substitute the sidecar binary.
pub(crate) fn smoke_startup_exit_requested() -> bool {
    env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
}

pub(crate) fn endpoint(name: &str, default: &str) -> Result<String, String> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() && value == value.trim() => Ok(value),
        Ok(_) => Err(format!(
      "Desktop initialization failed: {name} must not be empty or contain surrounding whitespace"
    )),
        Err(VarError::NotPresent) => Ok(default.to_owned()),
        Err(error) => Err(format!(
            "Desktop initialization failed: could not read {name}: {error}"
        )),
    }
}

pub(crate) fn optional_value(name: &str) -> Result<String, String> {
    match env::var(name) {
        Ok(value) => Ok(value),
        Err(VarError::NotPresent) => Ok(String::new()),
        Err(error) => Err(format!(
            "Desktop initialization failed: could not read {name}: {error}"
        )),
    }
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
    fn explicit_environment_value_overrides_the_default() {
        let expected = env::var("PATH").expect("PATH must exist during tests");

        assert_eq!(endpoint("PATH", "fallback"), Ok(expected));
    }
}
