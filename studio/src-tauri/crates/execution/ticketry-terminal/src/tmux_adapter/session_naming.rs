//! The one derivation of Ticketry's persisted tmux session names.
//!
//! Persistence, discovery, cleanup, and lifecycle recovery all name sessions
//! through [`PersistedSessionName`], so the recorded name can never drift from
//! the name this adapter actually creates, inspects, and kills.

use std::fmt;

use super::types::{validate_identifier, OwnedSession, RuntimeIdentity, TmuxAdapterError};

/// Prefix marking a tmux session as Ticketry-owned.
pub const SESSION_PREFIX: &str = "pt-";

/// The tmux session name belonging to one Agent Run.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct PersistedSessionName(String);

impl PersistedSessionName {
    /// Derive the name for a runtime identity the adapter has already validated.
    pub fn for_identity(identity: &RuntimeIdentity) -> Self {
        Self::derive(identity.agent_run_id())
    }

    /// Derive the name for a session the adapter verified as Ticketry-owned.
    pub fn for_owned_session(session: &OwnedSession) -> Self {
        Self::derive(&session.agent_run_id)
    }

    /// Derive the name for a bare Agent Run identifier, rejecting identifiers
    /// tmux would not accept.
    pub fn for_agent_run(agent_run_id: &str) -> Result<Self, TmuxAdapterError> {
        validate_identifier(agent_run_id)?;
        Ok(Self::derive(agent_run_id))
    }

    /// Whether a persisted name is the name this adapter derives for the run.
    pub fn records(persisted: &str, agent_run_id: &str) -> bool {
        Self::for_agent_run(agent_run_id)
            .is_ok_and(|expected| expected.as_str() == persisted || persisted == agent_run_id)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }

    pub(super) fn derive(agent_run_id: &str) -> Self {
        Self(format!("{SESSION_PREFIX}{agent_run_id}"))
    }
}

impl fmt::Display for PersistedSessionName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<PersistedSessionName> for String {
    fn from(value: PersistedSessionName) -> Self {
        value.0
    }
}

/// Adapter-internal shorthand for tmux target arguments.
pub(super) fn session_name(agent_run_id: &str) -> String {
    PersistedSessionName::derive(agent_run_id).into_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_point_derives_the_same_name() {
        let identity = RuntimeIdentity::new("run-123", "desktop").unwrap();
        let owned = OwnedSession {
            agent_run_id: "run-123".to_owned(),
            runtime_namespace: "desktop".to_owned(),
            running: true,
            exit_code: None,
        };
        assert_eq!(
            PersistedSessionName::for_identity(&identity).as_str(),
            "pt-run-123"
        );
        assert_eq!(
            PersistedSessionName::for_owned_session(&owned).as_str(),
            "pt-run-123"
        );
        assert_eq!(
            PersistedSessionName::for_agent_run("run-123")
                .unwrap()
                .as_str(),
            "pt-run-123"
        );
        assert!(PersistedSessionName::records("pt-run-123", "run-123"));
        assert!(PersistedSessionName::records("run-123", "run-123"));
    }

    #[test]
    fn rejects_names_tmux_would_not_accept_and_recorded_names_that_drifted() {
        assert!(PersistedSessionName::for_agent_run("run;kill").is_err());
        assert!(PersistedSessionName::for_agent_run("").is_err());
        assert!(!PersistedSessionName::records("legacy-other", "run-123"));
        assert!(!PersistedSessionName::records("pt-other", "run-123"));
        assert!(!PersistedSessionName::records("pt-run;kill", "run;kill"));
    }
}
