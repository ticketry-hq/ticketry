//! Tested Seaolim Action decision for CODING-1285.
//!
//! `terminal_session_update` stays on its authored, model-shaped view. The
//! input is a tri-state patch, but the pinned `ActionContext` exposes only
//! required string and ID readers. It cannot distinguish omitted input from
//! explicit null. The persistence protocol also needs two multi-model atomic
//! commits. Preparation creates the Cleanup Effect and marks the Terminal
//! Session pending together. Settlement commits the Session tombstone, Agent
//! Run outcome, status event, and applied Cleanup Effect together after tmux
//! absence has been proved. An Action serializer `save()` commits one model
//! before returning, so no ordering of saves preserves those crash states.
//!
//! Passing `TerminalCleanupService` through `ActionContext::data` would keep
//! the protocol but bypass Action serializers for every write. That would
//! rename the resolver, not migrate it to an Action.

use super::CleanupCheckpoint;

pub struct ActionCompatibilityStage {
    pub checkpoint: CleanupCheckpoint,
    pub durable_state: &'static str,
    pub recovery: &'static str,
    pub action_fit: &'static str,
}

pub const VERDICT: &str = "incompatible: keep the authored Terminal Session update view";

pub const INPUT_CONTRACT: &str =
    "termination_request_id remains omitted | null | request identity; ActionContext cannot read this tri-state";

pub const RESULT_CONTRACT: &str =
    "the mutation still returns the authoritative AgentTerminalSessions entity";

/// The shipping cleanup order. Integration tests inject a stop inside the
/// settlement transaction and prove rollback plus recovery without a second
/// kill or duplicate status fact.
pub const STAGES: &[ActionCompatibilityStage] = &[
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Preparation,
        durable_state: "Cleanup Effect preparation and Terminal Session runtime_cleanup_pending commit together before runtime work",
        recovery: "a prepared effect is the durable journal entry and reconciliation can claim it",
        action_fit: "incompatible because separate Cleanup Effect and Terminal Session saves expose a partial journal",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Claim,
        durable_state: "the Cleanup Effect has a bounded lease and attempt count",
        recovery: "an expired lease is reclaimed without replacing the cause-bound effect identity",
        action_fit: "valid only after the atomic preparation commit",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Inspect,
        durable_state: "no new row; Ticketry observes the owned tmux runtime",
        recovery: "missing, running, exited, foreign, ambiguous, and unavailable observations choose explicit paths",
        action_fit: "external observation can run between saves but depends on the journal",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Kill,
        durable_state: "the verified tmux runtime may be killed while the leased Cleanup Effect and pending Session remain durable",
        recovery: "reconciliation proves absence before settlement and never spends a second kill after absence",
        action_fit: "the external effect fits only with the existing journal and recovery protocol",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::TerminalTombstone,
        durable_state: "terminated_at and runtime_cleanup_pending changes are uncommitted inside settlement",
        recovery: "a stop rolls the Session changes back and leaves the leased effect recoverable",
        action_fit: "incompatible because a Session serializer save would already commit",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::RunFact,
        durable_state: "the Agent Run outcome is uncommitted in the same settlement transaction",
        recovery: "a stop rolls back both the Session and Agent Run changes",
        action_fit: "incompatible with an independently committed Agent Run save",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::StatusAppend,
        durable_state: "the terminal status event is uncommitted with the Session and Agent Run",
        recovery: "a stop leaves no status event; replay appends exactly one committed fact",
        action_fit: "incompatible with a separately committed status-event save",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Settlement,
        durable_state: "Session tombstone, Agent Run outcome, status event, and applied Cleanup Effect commit together",
        recovery: "an applied effect returns the authoritative Session without repeating runtime work",
        action_fit: "incompatible with one-model Action save stages",
    },
    ActionCompatibilityStage {
        checkpoint: CleanupCheckpoint::Response,
        durable_state: "no new write; the authoritative Terminal Session entity is returned",
        recovery: "a lost response replays to the same entity",
        action_fit: "the entity result fits, but the input and persistence stages do not",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_record_covers_every_cleanup_checkpoint_in_order() {
        assert_eq!(
            STAGES
                .iter()
                .map(|stage| stage.checkpoint)
                .collect::<Vec<_>>(),
            vec![
                CleanupCheckpoint::Preparation,
                CleanupCheckpoint::Claim,
                CleanupCheckpoint::Inspect,
                CleanupCheckpoint::Kill,
                CleanupCheckpoint::TerminalTombstone,
                CleanupCheckpoint::RunFact,
                CleanupCheckpoint::StatusAppend,
                CleanupCheckpoint::Settlement,
                CleanupCheckpoint::Response,
            ]
        );
    }

    #[test]
    fn compatibility_record_answers_every_acceptance_concern() {
        let record = STAGES
            .iter()
            .flat_map(|stage| [stage.durable_state, stage.recovery, stage.action_fit])
            .chain([INPUT_CONTRACT, RESULT_CONTRACT])
            .collect::<Vec<_>>()
            .join(" ");
        for concern in [
            "omitted",
            "null",
            "request identity",
            "journal",
            "tmux",
            "kill",
            "settlement",
            "recovery",
            "AgentTerminalSessions",
        ] {
            assert!(record.contains(concern), "missing {concern} comparison");
        }
        assert!(VERDICT.contains("keep the authored"));
    }
}
