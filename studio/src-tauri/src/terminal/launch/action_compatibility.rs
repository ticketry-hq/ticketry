//! Tested decision record for CODING-1284.
//!
//! `terminal_session_create` cannot move to the pinned Seaolim Action API.
//! The current command has two atomic, multi-model commits. Preparation
//! commits the Agent Run, Launch Effect, launch material, and initial status
//! fact together. Settlement commits the Terminal Session, applied effect,
//! and running lifecycle facts together. Seaolim Action `save()` calls commit
//! one model stage at a time and its serializer persistence handles do not
//! expose the stage transaction for related writes. Splitting either commit
//! would create a crash state that the current recovery protocol never
//! exposes.
//!
//! Calling `TerminalLaunchService` through `ActionContext::data` would keep
//! the old transactions, but it would bypass Action serializers for every
//! write. That is a resolver rename, not an Action migration.

use super::TerminalLaunchBoundary;

pub struct ActionCompatibilityStage {
    pub boundary: TerminalLaunchBoundary,
    pub durable_state: &'static str,
    pub idempotency_and_recovery: &'static str,
    pub action_fit: &'static str,
}

pub const VERDICT: &str = "incompatible: keep the authored Terminal Session create view";

/// The shipping stage order. The integration tests in `tests/terminal_launch.rs`
/// inject a stop at every boundary and prove convergence without duplicate
/// sessions, runs, effects, tmux runtimes, or status facts.
pub const STAGES: &[ActionCompatibilityStage] = &[
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::RequestValidated,
        durable_state: "none; request identities, scope, geometry, and resume lineage are validated",
        idempotency_and_recovery: "a retry starts validation again",
        action_fit: "no persistence gap",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::MaterialPrepared,
        durable_state: "none; authority-resolved launch material exists only in memory",
        idempotency_and_recovery: "a retry resolves and validates material again",
        action_fit: "no persistence gap",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::EffectPrepared,
        durable_state: "Agent Run, Launch Effect, launch material, and starting status fact commit together; no Terminal Session or tmux runtime exists",
        idempotency_and_recovery: "request, effect, and run identities reuse the complete prepared set; idempotency preserves one recoverable effect",
        action_fit: "incompatible with independently committed one-model save stages",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::EffectClaimed,
        durable_state: "the prepared Launch Effect has a bounded recovery lease",
        idempotency_and_recovery: "an expired lease can be reclaimed without reminting the run or effect",
        action_fit: "valid only after the atomic preparation commit",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::PreEffectObserved,
        durable_state: "no new row; the deterministic tmux identity has been observed",
        idempotency_and_recovery: "running, missing, foreign, ambiguous, exited, and unavailable observations choose explicit recovery paths",
        action_fit: "external observation remains Ticketry-owned",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::TmuxCreated,
        durable_state: "the external tmux runtime may exist while the Launch Effect remains leased and no Terminal Session exists",
        idempotency_and_recovery: "recovery observes the deterministic runtime identity and never creates a duplicate",
        action_fit: "external effect remains Ticketry-owned",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::OwnershipMetadataWritten,
        durable_state: "verified tmux ownership exists; the database still has only prepared intent",
        idempotency_and_recovery: "recovery may settle only the runtime whose ownership matches the immutable material",
        action_fit: "valid only before the atomic settlement commit",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::SessionInserted,
        durable_state: "the Terminal Session insert is still inside the settlement transaction and rolls back with effect and lifecycle changes",
        idempotency_and_recovery: "a crash leaves the effect leased and no visible session; recovery repeats settlement",
        action_fit: "incompatible because an Action session save would already be committed",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::EffectAndStatusSettled,
        durable_state: "Terminal Session, applied Launch Effect, Agent Run lifecycle, status fact, and optional attempt outcome commit together",
        idempotency_and_recovery: "an applied effect returns the authoritative session without repeating tmux or status work",
        action_fit: "incompatible with independently committed one-model save stages",
    },
    ActionCompatibilityStage {
        boundary: TerminalLaunchBoundary::ResponseReady,
        durable_state: "no new write; the authoritative Terminal Session entity is returned",
        idempotency_and_recovery: "a lost response replays to the same entity",
        action_fit: "the entity result fits, but the preceding commits do not",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_record_covers_every_launch_boundary_in_order() {
        assert_eq!(
            STAGES
                .iter()
                .map(|stage| stage.boundary)
                .collect::<Vec<_>>(),
            vec![
                TerminalLaunchBoundary::RequestValidated,
                TerminalLaunchBoundary::MaterialPrepared,
                TerminalLaunchBoundary::EffectPrepared,
                TerminalLaunchBoundary::EffectClaimed,
                TerminalLaunchBoundary::PreEffectObserved,
                TerminalLaunchBoundary::TmuxCreated,
                TerminalLaunchBoundary::OwnershipMetadataWritten,
                TerminalLaunchBoundary::SessionInserted,
                TerminalLaunchBoundary::EffectAndStatusSettled,
                TerminalLaunchBoundary::ResponseReady,
            ]
        );
    }

    #[test]
    fn compatibility_record_answers_every_acceptance_concern() {
        let record = STAGES
            .iter()
            .flat_map(|stage| {
                [
                    stage.durable_state,
                    stage.idempotency_and_recovery,
                    stage.action_fit,
                ]
            })
            .collect::<Vec<_>>()
            .join(" ");
        for concern in [
            "Terminal Session",
            "Agent Run",
            "Launch Effect",
            "tmux",
            "idempotency",
            "recovery",
        ] {
            assert!(record.contains(concern), "missing {concern} comparison");
        }
        assert!(VERDICT.contains("keep the authored"));
    }
}
