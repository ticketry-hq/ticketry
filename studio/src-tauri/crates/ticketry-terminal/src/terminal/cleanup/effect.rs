use sha2::{Digest, Sha256};

use super::{TerminalCleanupError, TerminalCleanupErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupCause {
    Explicit,
    LaunchCompensation,
    HostedExit,
    OwnedOrphan,
    TemporaryProfile,
}

impl CleanupCause {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::LaunchCompensation => "launch_compensation",
            Self::HostedExit => "hosted_exit",
            Self::OwnedOrphan => "owned_orphan",
            Self::TemporaryProfile => "temporary_profile",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CleanupEffectIdentity {
    pub effect_id: String,
    pub agent_run_id: String,
    pub cause: CleanupCause,
}

impl CleanupEffectIdentity {
    pub fn predetermined(
        agent_run_id: &str,
        cause: CleanupCause,
        cause_identity: &str,
    ) -> Result<Self, TerminalCleanupError> {
        if agent_run_id.is_empty()
            || agent_run_id.len() > 255
            || cause_identity.is_empty()
            || cause_identity.len() > 255
            || agent_run_id
                .chars()
                .chain(cause_identity.chars())
                .any(char::is_control)
        {
            return Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::InvalidRequest,
                "The terminal cleanup identity is invalid.",
            ));
        }
        let digest = Sha256::digest(
            format!(
                "ticketry-terminal-cleanup-v1\0{agent_run_id}\0{}\0{cause_identity}",
                cause.as_str()
            )
            .as_bytes(),
        );
        Ok(Self {
            effect_id: format!("{digest:x}")[..32].to_owned(),
            agent_run_id: agent_run_id.to_owned(),
            cause,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_cleanup_cause_has_a_stable_distinct_identity() {
        let causes = [
            CleanupCause::Explicit,
            CleanupCause::LaunchCompensation,
            CleanupCause::HostedExit,
            CleanupCause::OwnedOrphan,
            CleanupCause::TemporaryProfile,
        ];
        let ids = causes.map(|cause| {
            CleanupEffectIdentity::predetermined("run-1", cause, "cause-1")
                .unwrap()
                .effect_id
        });
        assert_eq!(
            ids,
            causes.map(|cause| {
                CleanupEffectIdentity::predetermined("run-1", cause, "cause-1")
                    .unwrap()
                    .effect_id
            })
        );
        let unique = ids.into_iter().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), causes.len());
    }
}
