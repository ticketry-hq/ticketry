//! Whether recorded tmux names and runtime namespaces are safe to reuse.
//!
//! A durable terminal session is a name plus a namespace, and after adoption
//! Ticketry passes both to tmux as command arguments to attach, inspect, and
//! kill sessions. A name carrying a shell metacharacter, a colon, a newline, or
//! a `.` would address something other than the session it claims to name, so
//! an installation is refused before those names reach a command line rather
//! than after.
//!
//! The names are judged as data. Preflight does not run tmux, list sessions, or
//! ask whether a session is alive: reconciliation decides what is live, and it
//! runs long after adoption commits.

use crate::tmux_adapter::PersistedSessionName;

/// Why one recorded runtime name is not one Ticketry may reuse.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NameDefect {
    /// The tmux session name is not a name Ticketry's adapter derives.
    UnsafeSessionName,
    /// The tmux session name does not belong to its own Agent Run.
    SessionNameForAnotherRun,
    /// The runtime namespace is not an identifier tmux can carry.
    UnsafeRuntimeNamespace,
}

impl NameDefect {
    /// The stable rule name this defect is reported under.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::UnsafeSessionName => "tmux-session-name-unsafe",
            Self::SessionNameForAnotherRun => "tmux-session-name-foreign",
            Self::UnsafeRuntimeNamespace => "runtime-namespace-unsafe",
        }
    }

    /// The rule in one operator-safe sentence.
    #[must_use]
    pub const fn rule(self) -> &'static str {
        match self {
            Self::UnsafeSessionName => {
                "every recorded tmux session name is one Ticketry's adapter can address"
            }
            Self::SessionNameForAnotherRun => {
                "a recorded tmux session name belongs to the Agent Run that recorded it"
            }
            Self::UnsafeRuntimeNamespace => {
                "every recorded runtime namespace is a plain host-safe identifier"
            }
        }
    }
}

/// Check the tmux session name one Agent Run recorded.
///
/// The adapter's own derivation is the authority: a persisted name is safe
/// exactly when it is the name the adapter would derive for that run, or the
/// bare run identifier a pre-prefix installation recorded. Anything else would
/// have Ticketry address a session it did not create.
#[must_use]
pub fn session_name(agent_run_id: &str, recorded: &str) -> Option<NameDefect> {
    if !safe_identifier(agent_run_id) || !safe_session_name(recorded) {
        return Some(NameDefect::UnsafeSessionName);
    }
    (!PersistedSessionName::records(recorded, agent_run_id))
        .then_some(NameDefect::SessionNameForAnotherRun)
}

/// Check a recorded runtime namespace.
#[must_use]
pub fn runtime_namespace(recorded: &str) -> Option<NameDefect> {
    (!safe_identifier(recorded)).then_some(NameDefect::UnsafeRuntimeNamespace)
}

/// A tmux session name is the adapter's prefix plus one safe identifier.
///
/// tmux treats `:` and `.` as target separators, so a name carrying either
/// addresses a window or a pane rather than the session. Everything outside the
/// identifier alphabet is refused for the same reason: the name reaches tmux as
/// an argument.
fn safe_session_name(recorded: &str) -> bool {
    recorded
        .strip_prefix(crate::tmux_adapter::SESSION_PREFIX)
        .map_or_else(|| safe_identifier(recorded), safe_identifier)
}

/// The identifier alphabet Ticketry's tmux adapter accepts.
///
/// This restates the adapter's own rule rather than calling it, because the
/// adapter's validator is private to the adapter and returns its own error
/// type. The two are kept together by a test that checks a name this function
/// accepts is a name the adapter will derive.
fn safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::{runtime_namespace, session_name, NameDefect};
    use crate::tmux_adapter::PersistedSessionName;

    #[test]
    fn the_adapters_own_derived_name_is_accepted() {
        let derived = PersistedSessionName::for_agent_run("run-1")
            .expect("the adapter derives this name")
            .into_string();
        assert_eq!(session_name("run-1", &derived), None);
    }

    #[test]
    fn a_pre_prefix_installation_recorded_the_bare_run_identifier() {
        assert_eq!(session_name("run-1", "run-1"), None);
    }

    #[test]
    fn a_name_addressing_a_pane_or_a_shell_is_refused() {
        for hostile in [
            "pt-run-1:0.1",
            "pt-run-1; rm -rf /",
            "pt-run-1$(whoami)",
            "pt-run 1",
            "pt-run-1\nkill-server",
            "pt-",
            "",
        ] {
            assert_eq!(
                session_name("run-1", hostile),
                Some(NameDefect::UnsafeSessionName),
                "{hostile} must be refused"
            );
        }
    }

    #[test]
    fn a_safe_name_belonging_to_another_run_is_refused() {
        assert_eq!(
            session_name("run-1", "pt-run-2"),
            Some(NameDefect::SessionNameForAnotherRun)
        );
    }

    #[test]
    fn an_unsafe_run_identifier_is_refused_whatever_it_recorded() {
        assert_eq!(
            session_name("run 1; whoami", "pt-run 1; whoami"),
            Some(NameDefect::UnsafeSessionName)
        );
    }

    #[test]
    fn a_namespace_must_be_a_plain_identifier() {
        assert_eq!(runtime_namespace("desktop"), None);
        assert_eq!(runtime_namespace("legacy-runtime"), None);
        for hostile in ["", "desktop:0", "../desktop", "desktop\0", &"x".repeat(129)] {
            assert_eq!(
                runtime_namespace(hostile),
                Some(NameDefect::UnsafeRuntimeNamespace),
                "{hostile} must be refused"
            );
        }
    }
}
