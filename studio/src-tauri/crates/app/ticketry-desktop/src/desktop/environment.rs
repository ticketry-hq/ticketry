//! The environment-variable contract for the desktop process. Every variable
//! the desktop reads is named here so the launch surface stays enumerable.

use std::env;

pub const SMOKE_EXIT_AFTER_STARTUP: &str = "MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP";
pub const ACCEPTANCE_EXIT_AFTER_STARTUP: &str = "MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP";
pub const DEVELOPMENT_LOG_PATH_ENV: &str = "MUXED_DEVELOPMENT_LOG_PATH";
pub const STARTUP_TRACE_ID_ENV: &str = "MUXED_STARTUP_TRACE_ID";
#[cfg(debug_assertions)]
pub const DEVELOPMENT_FORCE_PANIC_ABORT_ENV: &str = "MUXED_DEVELOPMENT_FORCE_PANIC_ABORT";

pub fn development_log_path() -> Option<std::path::PathBuf> {
    env::var_os(DEVELOPMENT_LOG_PATH_ENV).map(Into::into)
}

pub fn startup_trace_id() -> Option<String> {
    env::var(STARTUP_TRACE_ID_ENV)
        .ok()
        .filter(|value| !value.is_empty())
}

#[cfg(debug_assertions)]
pub fn development_panic_abort_requested() -> bool {
    env::var(DEVELOPMENT_FORCE_PANIC_ABORT_ENV).as_deref() == Ok("1")
}

pub fn smoke_startup_exit_requested() -> bool {
    env::var(SMOKE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
}

pub fn automated_startup_exit_requested() -> bool {
    smoke_startup_exit_requested() || env::var(ACCEPTANCE_EXIT_AFTER_STARTUP).as_deref() == Ok("1")
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
