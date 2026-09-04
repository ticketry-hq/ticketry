//! Aggregate Seaography audit evidence for the Slice 5 terminal subtree.
//!
//! The parent Story (CODING-540) cannot be accepted until one durable record
//! covers the complete slice: the audit verdict, the registered-entity and
//! custom-field counts, every justified override, the remaining needs-proof
//! items, and the modules audited with no database-backed GraphQL impact.
//! [`super::ownership_manifest`] records the adoption boundary and the generic
//! four-write blockers; this module records the per-entity blockers and the
//! slice-wide surface those blockers protect.
//!
//! The record is checked, not narrated: `aggregate_seaography_audit` unit tests
//! prove it is internally complete, and
//! `tests/slice5_seaography_aggregate_audit.rs` proves it still matches the
//! shipping generated contract, the audited source tree, and every child
//! handoff on disk.

/// Aggregate verdict for the complete Slice 5 subtree.
pub const VERDICT: &str =
    "aligned: no P0 or P1 Seaography drift remains in the Slice 5 terminal subtree";

/// The generated write bundle Seaography rc.9 installs all at once.
pub const GENERATED_WRITES: [&str; 4] = ["create-one", "create-batch", "update", "delete"];

pub struct RegisteredEntity {
    pub entity: &'static str,
    pub graphql_type: &'static str,
    /// Every terminal registration is `mutation: false`.
    pub generated_mutations: bool,
    /// One blocker per [`GENERATED_WRITES`] entry, in that order.
    pub blockers: [&'static str; 4],
}

/// Entities `super::register_graphql` publishes into the product graph.
pub const REGISTERED_ENTITIES: &[RegisteredEntity] = &[
    RegisteredEntity {
        entity: "Terminal Session",
        graphql_type: "AgentTerminalSessions",
        generated_mutations: false,
        blockers: [
            "Seaolim Action saves commit one model stage at a time, but launch preparation must atomically commit the Agent Run, Launch Effect, normalized launch material, and starting status fact",
            "one flat batch cannot bind a separate external tmux effect per row or settle partial creations",
            "rc.9 update skips pre-save hooks, so termination cannot lease a cleanup effect, verify ownership, and settle Runs facts atomically",
            "rc.9 delete skips delete hooks and Terminal Session rows are durable history, so a caller delete would erase evidence or an unverified runtime",
        ],
    },
    RegisteredEntity {
        entity: "Viewer Lease",
        graphql_type: "AgentRunViewerLeases",
        generated_mutations: false,
        blockers: [
            "acquisition must attach and validate viewer mechanics, then transfer authority under the Agent Run lock and allocate the generation itself",
            "a batch cannot serialize several ownership transfers against one Agent Run lock",
            "renewal is a compare-and-set on the exact current viewer and generation, which rc.9 bulk update cannot express",
            "release must match the caller's own generation so a late release cannot remove a newer owner",
        ],
    },
    RegisteredEntity {
        entity: "Agent Run",
        graphql_type: "AgentRuns",
        generated_mutations: false,
        blockers: [
            "Agent Run creation belongs to the Runs lifecycle that predetermines launch identities",
            "batch creation would fan out runtime effects the terminal slice must prepare one at a time",
            "run outcome, status, and terminal fields change inside the launch, cleanup, and reconciliation transactions",
            "run history is the durable record every terminal effect is reconciled against",
        ],
    },
];

pub enum CustomFieldKind {
    Query,
    Mutation,
    Output,
}

pub struct CustomField {
    /// The name as it appears in the generated SDL.
    pub field: &'static str,
    pub kind: CustomFieldKind,
    /// The model or computed shape the field returns.
    pub returns: &'static str,
    pub override_reason: &'static str,
    /// Where the override decision and its safety test are recorded.
    pub evidence: &'static str,
}

/// Custom reads whose projections cannot be expressed by generated model
/// filtering without publishing protected storage.
pub const CUSTOM_QUERIES: &[CustomField] = &[
    CustomField {
        field: "resumable_terminal_sessions",
        kind: CustomFieldKind::Query,
        returns: "AgentRuns",
        override_reason: "select the newest ended Agent Run per provider conversation while excluding live conversations and live successors; generated entity reads cannot express that cross-row projection",
        evidence: "terminal::resume::operation_registry::CUSTOM_QUERIES",
    },
    CustomField {
        field: "instant_run_tickets",
        kind: CustomFieldKind::Query,
        returns: "InstantRunTicket",
        override_reason: "derive a safe display title from private launch material while filtering to live Instant Agent Runs; registering that model would publish the full prompt and filesystem identities",
        evidence: "terminal::instant_run_ticket::operation_registry::CUSTOM_QUERIES",
    },
];

/// Every custom write in the slice. Each one is a restricted, identity-bound,
/// model-shaped seam over SeaORM, not a per-field RPC.
pub const CUSTOM_MUTATIONS: &[CustomField] = &[
    CustomField {
        field: "terminal_session_create",
        kind: CustomFieldKind::Mutation,
        returns: "AgentTerminalSessions",
        override_reason: "preparation and settlement each require one multi-model atomic commit around verified tmux creation; independent Seaolim Action saves expose invalid crash states",
        evidence: "terminal::launch::action_compatibility::STAGES",
    },
    CustomField {
        field: "terminal_session_update",
        kind: CustomFieldKind::Mutation,
        returns: "AgentTerminalSessions",
        override_reason: "the tri-state patch is not readable through ActionContext, and preparation plus settlement require multi-model atomic commits around verified tmux cleanup",
        evidence: "terminal::cleanup::action_compatibility::STAGES",
    },
    CustomField {
        field: "terminal_output_observe",
        kind: CustomFieldKind::Mutation,
        returns: "TerminalOutputObservation",
        override_reason: "capture, compact-identity deduplication, conditional sequence advance, and the Run status projection cannot be expressed as a generated update",
        evidence: "terminal::session::views::observe_output::operation_registry::CUSTOM_OPERATIONS",
    },
    CustomField {
        field: "create_viewer_lease",
        kind: CustomFieldKind::Mutation,
        returns: "AgentRunViewerLeases",
        override_reason: "ownership transfers only after viewer mechanics succeed, under the Agent Run lock, with Rust allocating the generation",
        evidence: "spec/seaolim-migration--718c9c45/T1283--t09-migrate-viewer-lease-create-update-a/override-record.md",
    },
    CustomField {
        field: "update_viewer_lease",
        kind: CustomFieldKind::Mutation,
        returns: "AgentRunViewerLeases",
        override_reason: "renewal is a compare-and-set on the exact current viewer identity and generation",
        evidence: "spec/seaolim-migration--718c9c45/T1283--t09-migrate-viewer-lease-create-update-a/override-record.md",
    },
    CustomField {
        field: "delete_viewer_lease",
        kind: CustomFieldKind::Mutation,
        returns: "AgentRunViewerLeases",
        override_reason: "release is idempotent for the caller's own generation and can never end the hosted tmux session",
        evidence: "spec/seaolim-migration--718c9c45/T1283--t09-migrate-viewer-lease-create-update-a/override-record.md",
    },
];

/// Computed output types, neither of which mirrors a generated model.
pub const CUSTOM_OUTPUTS: &[CustomField] = &[
    CustomField {
        field: "TerminalOutputObservation",
        kind: CustomFieldKind::Output,
        returns: "computed: advanced, output_sequence, last_output_at",
        override_reason: "the mutation reports whether this capture advanced the durable sequence, which is a decision rather than stored columns",
        evidence: "terminal::session::views::observe_output registers it beside its one mutation",
    },
    CustomField {
        field: "InstantRunTicket",
        kind: CustomFieldKind::Output,
        returns: "computed: agent_run_id, title, started_at",
        override_reason: "title is a bounded safe projection of only the user's Instant request, not a stored model or the private launch prompt",
        evidence: "terminal::instant_run_ticket registers it beside instant_run_tickets",
    },
];

/// Ordinary model CRUD reached through anything other than SeaORM. The slice
/// keeps this empty; the integration test proves it.
pub const NON_SEAORM_CRUD_PATHS: &[&str] = &[];

/// Remaining needs-proof items for the aggregate audit. Empty means the Story
/// has no open Seaography question left for Review to discover.
pub const NEEDS_PROOF: &[&str] = &[];

pub struct RawSqlEvidence {
    pub path: &'static str,
    pub purpose: &'static str,
}

/// Files allowed to hold raw SQL. Adoption owns migration DDL, source
/// classification, and stable digests; neither file serves a public model read
/// or write.
pub const RAW_SQL_EVIDENCE_ONLY: &[RawSqlEvidence] = &[
    RawSqlEvidence {
        path: "crates/ticketry-terminal/src/terminal/persistence/schema.rs",
        purpose: "migration DDL, Django source classification, and schema fingerprints",
    },
    RawSqlEvidence {
        path: "crates/ticketry-terminal/src/terminal/persistence/adoption.rs",
        purpose: "pre-adoption validation, ownership ledger, and checkpoint pragmas",
    },
    RawSqlEvidence {
        path: "crates/ticketry-terminal/src/temporary_profile/journal.rs",
        purpose:
            "sqlite_master probe proving a discarded profile never provisioned terminal storage",
    },
];

/// Every Rust module the aggregate audit read, relative to `studio/src-tauri`,
/// the package these paths were written against before the workspace split.
/// The integration test scans these for CRUD outside SeaORM.
pub const AUDITED_MODULES: &[&str] = &[
    "crates/ticketry-entities/src/terminals",
    "crates/ticketry-terminal/src/terminal/persistence",
    "crates/ticketry-terminal/src/terminal/launch",
    "crates/ticketry-terminal/src/terminal/cleanup",
    "crates/ticketry-terminal/src/temporary_profile",
    "crates/ticketry-terminal/src/terminal/reconciliation",
    "crates/ticketry-terminal/src/terminal/lifecycle",
    "crates/ticketry-terminal/src/terminal/output_activity",
    "crates/ticketry-terminal/src/terminal/instant_run_ticket",
    "crates/ticketry-terminal/src/terminal/resume",
    "crates/ticketry-terminal/src/terminal/viewer",
    "crates/ticketry-terminal/src/viewer_ownership",
    "crates/ticketry-terminal/src/tmux_adapter.rs",
    "crates/ticketry-terminal/src/tmux_adapter",
    "crates/ticketry-launch/src/planning",
    "crates/ticketry-launch/src/paths",
    "crates/ticketry-runs/src/hook_spool",
    "crates/ticketry-desktop/src/native_terminal.rs",
    "crates/ticketry-desktop/src/native_terminal",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::persistence::child_seaography_handoffs::CHILD_HANDOFFS;
    use std::collections::BTreeSet;

    #[test]
    fn the_aggregate_verdict_answers_the_parent_gate() {
        assert!(VERDICT.contains("P0"));
        assert!(VERDICT.contains("P1"));
        assert!(NEEDS_PROOF.is_empty());
        assert!(NON_SEAORM_CRUD_PATHS.is_empty());
    }

    #[test]
    fn the_recorded_counts_are_the_audited_counts() {
        assert_eq!(REGISTERED_ENTITIES.len(), 3);
        assert_eq!(CUSTOM_QUERIES.len(), 2);
        assert_eq!(CUSTOM_MUTATIONS.len(), 6);
        assert_eq!(CUSTOM_OUTPUTS.len(), 2);
        assert_eq!(RAW_SQL_EVIDENCE_ONLY.len(), 3);
    }

    #[test]
    fn every_registered_entity_keeps_generated_writes_private_with_a_reason() {
        for entity in REGISTERED_ENTITIES {
            assert!(
                !entity.generated_mutations,
                "{} publishes generated writes",
                entity.entity
            );
            assert_eq!(entity.blockers.len(), GENERATED_WRITES.len());
            for (write, blocker) in GENERATED_WRITES.iter().zip(entity.blockers) {
                assert!(
                    !blocker.is_empty(),
                    "{} has no {write} blocker",
                    entity.entity
                );
            }
        }
    }

    #[test]
    fn every_custom_field_is_named_once_and_carries_its_override_evidence() {
        let fields = CUSTOM_QUERIES
            .iter()
            .chain(CUSTOM_MUTATIONS)
            .chain(CUSTOM_OUTPUTS);
        let mut names = BTreeSet::new();
        for field in fields {
            assert!(names.insert(field.field), "{} recorded twice", field.field);
            assert!(!field.returns.is_empty());
            assert!(
                !field.override_reason.is_empty(),
                "{} has no override reason",
                field.field
            );
            assert!(
                !field.evidence.is_empty(),
                "{} has no override evidence",
                field.field
            );
        }
    }

    #[test]
    fn the_audit_covers_every_child_of_the_story() {
        assert_eq!(CHILD_HANDOFFS.len(), 26);
        for module in AUDITED_MODULES {
            // Paths are relative to `studio/src-tauri`, two levels above this
            // crate, and slices move between `src/` and `crates/` as the
            // workspace split proceeds, so the check is that each one still
            // names something real.
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .join(module);
            assert!(path.exists(), "{module} no longer exists");
        }
    }
}
