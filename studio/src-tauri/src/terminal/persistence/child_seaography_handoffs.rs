//! Per-child Seaography handoff index for the Slice 5 subtree.
//!
//! The parent gate requires every Implementation child to report a verdict,
//! its registered-entity and custom-field counts, its justified overrides, its
//! remaining needs-proof items, and — when it changed no database-backed
//! GraphQL — the files it checked and its no-impact conclusion. This module is
//! the durable index of those handoffs, so a missing or drifting handoff fails
//! a test instead of surfacing for the first time in Review.
//!
//! `Reconciled` children have their evidence file on disk; CODING-970 authored
//! the ones their own handoff omitted. `Open` children are still in Implement
//! and owe the recorded evidence at their own Review.

pub enum HandoffImpact {
    /// The child changed database-backed GraphQL.
    DatabaseBackedGraphql,
    /// The child changed no entity, registration, field, input, or output.
    NoImpact,
}

pub enum HandoffStatus {
    /// Evidence exists at [`ChildHandoff::evidence`], relative to the repository root.
    Reconciled,
    /// The child has not reached Review yet; the recorded evidence is its obligation.
    Open,
}

pub struct ChildHandoff {
    pub ticket: &'static str,
    pub scope: &'static str,
    pub impact: HandoffImpact,
    pub status: HandoffStatus,
    pub verdict: &'static str,
    pub evidence: &'static str,
    /// Paths this audit read for the child, relative to the repository root.
    pub files_checked: &'static [&'static str],
}

pub const CHILD_HANDOFFS: &[ChildHandoff] = &[
    ChildHandoff {
        ticket: "CODING-864",
        scope: "terminal lifecycle integration harness",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: test harness only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T864--build-the-rust-terminal-lifecycle-integr/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/tests/common/terminal_lifecycle_harness.rs",
            "studio/src-tauri/tests/common/isolated_tmux.rs",
            "studio/src-tauri/tests/common/terminal_reconciliation_runtime.rs",
            "studio/src-tauri/tests/terminal_lifecycle_harness.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-865",
        scope: "terminal schema adoption and SeaORM entities",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T865--adopt-terminal-persistence-and-generate/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/entities/terminals",
            "studio/src-tauri/src/terminal/persistence",
        ],
    },
    ChildHandoff {
        ticket: "CODING-866",
        scope: "verified tmux lifecycle operations",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: runtime adapter only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T866--centralize-verified-tmux-lifecycle-opera/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/tmux_adapter.rs",
            "studio/src-tauri/src/tmux_adapter",
        ],
    },
    ChildHandoff {
        ticket: "CODING-867",
        scope: "approved provider launch planning",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: pure planning, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T867--centralize-approved-provider-launch-plan/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/launch/planning",
            "studio/src-tauri/src/launch/paths",
        ],
    },
    ChildHandoff {
        ticket: "CODING-868",
        scope: "scoped generated Terminal Session reads",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T868--expose-scoped-generated-terminal-session/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/persistence/mod.rs",
            "studio/src-tauri/src/terminal/persistence/graphql_scope.rs",
            "studio/src/features/agents/terminal/operations/terminalSessions.graphql",
        ],
    },
    ChildHandoff {
        ticket: "CODING-869",
        scope: "terminal viewers through the Rust tmux adapter",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: viewer mechanics only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T869--route-terminal-viewers-through-the-rust/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/viewer",
            "studio/src-tauri/src/native_terminal",
            "studio/src-tauri/src/native_terminal.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-870",
        scope: "provider hook spooling and ingestion",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: filesystem spool only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T870--port-provider-hook-spooling-and-ingestio/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/hook_spool",
            "studio/src-tauri/src/terminal/lifecycle/spool_layout.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-871",
        scope: "restricted Terminal Session create",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T871--launch-one-terminal-through-the-restrict/AUDIT.md",
        files_checked: &["studio/src-tauri/src/terminal/launch"],
    },
    ChildHandoff {
        ticket: "CODING-872",
        scope: "restricted Viewer Lease create, update, and delete",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T872--enforce-atomic-viewer-ownership-with-res/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/viewer_ownership",
            "studio/src/features/agents/terminal/operations/viewerLeases.graphql",
        ],
    },
    ChildHandoff {
        ticket: "CODING-873",
        scope: "Terminal Session create recovery",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T873--make-terminal-launch-recovery-converge-a/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/launch/execution.rs",
            "studio/src-tauri/src/terminal/launch/settlement.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-874",
        scope: "resumable conversation custom query",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T874--resume-provider-conversations-into-new-t/AUDIT.md",
        files_checked: &["studio/src-tauri/src/terminal/resume"],
    },
    ChildHandoff {
        ticket: "CODING-875",
        scope: "durable verified cleanup and termination",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T875--implement-durable-verified-cleanup-and-t/AUDIT.md",
        files_checked: &["studio/src-tauri/src/terminal/cleanup"],
    },
    ChildHandoff {
        ticket: "CODING-876",
        scope: "reconciliation of recorded sessions against tmux",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: host operation, adds no GraphQL field",
        evidence: "spec/rusting--cf2de16d/T876--reconcile-recorded-sessions-with-verifie/AUDIT.md",
        files_checked: &["studio/src-tauri/src/terminal/reconciliation"],
    },
    ChildHandoff {
        ticket: "CODING-877",
        scope: "owned-orphan quarantine and runtime conflicts",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: host operation, adds no GraphQL field",
        evidence: "spec/rusting--cf2de16d/T877--quarantine-owned-orphans-and-surface-run/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/reconciliation/unrecorded.rs",
            "studio/src-tauri/src/terminal/cleanup/service.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-878",
        scope: "bounded startup, sweeps, and shutdown",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: scheduling only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T878--wire-bounded-terminal-startup-sweeps-and/AUDIT.md",
        files_checked: &["studio/src-tauri/src/terminal/lifecycle"],
    },
    ChildHandoff {
        ticket: "CODING-879",
        scope: "Studio terminal flows cut over to Rust",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Reconciled,
        verdict: "aligned",
        evidence: "spec/rusting--cf2de16d/T879--cut-studio-terminal-flows-over-to-rust/AUDIT.md",
        files_checked: &[
            "studio/src/features/agents/terminal/operations",
            "studio/src/features/agents/terminal/generated",
            "studio/src/features/agents/terminal/internal",
        ],
    },
    ChildHandoff {
        ticket: "CODING-880",
        scope: "removal of the Python terminal authority",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: removal only, Rust GraphQL surface unchanged",
        evidence: "spec/rusting--cf2de16d/T880--remove-the-python-terminal-authority/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/persistence",
            "studio/src-tauri/src/terminal/launch",
            "studio/src/graphql-foundation/generated/schema.graphql",
        ],
    },
    ChildHandoff {
        ticket: "CODING-881",
        scope: "packaged terminal recovery and dogfood gates",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: gate wiring, expected no GraphQL surface",
        evidence: "handoff due with the packaged gate change",
        files_checked: &["studio/src-tauri/tests/terminal_lifecycle_harness.rs"],
    },
    ChildHandoff {
        ticket: "CODING-963",
        scope: "healthy viewers must survive periodic reconciliation",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: expected reconciliation-only change",
        evidence: "handoff due with the reconciliation fix",
        files_checked: &["studio/src-tauri/src/terminal/reconciliation/service.rs"],
    },
    ChildHandoff {
        ticket: "CODING-964",
        scope: "reconciliation past the first 200 terminal rows",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: expected bounded-batch change",
        evidence: "handoff due with the batch fix",
        files_checked: &["studio/src-tauri/src/terminal/reconciliation/batch.rs"],
    },
    ChildHandoff {
        ticket: "CODING-965",
        scope: "launch policy and prompts resolved before persistence",
        impact: HandoffImpact::DatabaseBackedGraphql,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: touches the restricted create seam",
        evidence: "handoff due with the launch-policy fix",
        files_checked: &[
            "studio/src-tauri/src/launch/terminal_session/request.rs",
            "studio/src-tauri/src/launch/planning",
        ],
    },
    ChildHandoff {
        ticket: "CODING-966",
        scope: "journalled cleanup before deleting a temporary profile database",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: teardown calls the registered temporary_profile cleanup seam only",
        evidence: "spec/rusting--cf2de16d/T966--journal-temporary-profile-terminal-clean/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/temporary_profile",
            "studio/src-tauri/src/terminal/cleanup/service.rs",
            "studio/src-tauri/src/terminal/cleanup/journal.rs",
            "studio/src-tauri/src/terminal/cleanup/effect.rs",
            "studio/src-tauri/src/main.rs",
            "studio/src-tauri/tests/temporary_profile_teardown.rs",
        ],
    },
    ChildHandoff {
        ticket: "CODING-967",
        scope: "persisted tmux session-name derivation in the adapter",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: expected adapter-only change",
        evidence: "handoff due with the session-naming fix",
        files_checked: &["studio/src-tauri/src/tmux_adapter/session_naming.rs"],
    },
    ChildHandoff {
        ticket: "CODING-968",
        scope: "removal of dead browser terminal REST and WebSocket fallbacks",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: expected removal only",
        evidence: "handoff due with the fallback removal",
        files_checked: &["studio/src/features/agents/terminal/internal"],
    },
    ChildHandoff {
        ticket: "CODING-969",
        scope: "terminal output-activity safety tests in the Slice 5 gate",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Open,
        verdict: "owed at its own Review: expected gate wiring only",
        evidence: "handoff due with the gate change",
        files_checked: &["studio/src-tauri/tests/terminal_output_activity.rs"],
    },
    ChildHandoff {
        ticket: "CODING-970",
        scope: "aggregate Seaography audit evidence for the Story",
        impact: HandoffImpact::NoImpact,
        status: HandoffStatus::Reconciled,
        verdict: "aligned: evidence only, no GraphQL surface",
        evidence: "spec/rusting--cf2de16d/T970--record-the-aggregate-seaography-audit-ev/AUDIT.md",
        files_checked: &[
            "studio/src-tauri/src/terminal/persistence/aggregate_seaography_audit.rs",
            "studio/src-tauri/src/terminal/persistence/child_seaography_handoffs.rs",
            "studio/src-tauri/tests/slice5_seaography_aggregate_audit.rs",
        ],
    },
];

/// Children whose handoff evidence must already exist on disk.
pub fn reconciled_handoffs() -> impl Iterator<Item = &'static ChildHandoff> {
    CHILD_HANDOFFS
        .iter()
        .filter(|handoff| matches!(handoff.status, HandoffStatus::Reconciled))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const SPEC: &str = "spec/rusting--cf2de16d";

    #[test]
    fn every_child_is_recorded_once() {
        let tickets = CHILD_HANDOFFS
            .iter()
            .map(|handoff| handoff.ticket)
            .collect::<BTreeSet<_>>();
        assert_eq!(tickets.len(), CHILD_HANDOFFS.len());
        for ticket in ["CODING-864", "CODING-880", "CODING-963", "CODING-970"] {
            assert!(tickets.contains(ticket), "{ticket} has no handoff record");
        }
    }

    #[test]
    fn every_handoff_records_a_verdict_scope_and_checked_files() {
        for handoff in CHILD_HANDOFFS {
            assert!(!handoff.scope.is_empty(), "{} has no scope", handoff.ticket);
            assert!(
                !handoff.verdict.is_empty(),
                "{} has no verdict",
                handoff.ticket
            );
            assert!(
                !handoff.files_checked.is_empty(),
                "{} lists no checked files",
                handoff.ticket
            );
        }
    }

    #[test]
    fn reconciled_handoffs_point_at_an_audit_document() {
        let reconciled = reconciled_handoffs().count();
        assert_eq!(reconciled, 19);
        for handoff in reconciled_handoffs() {
            assert!(
                handoff.evidence.starts_with(SPEC) && handoff.evidence.ends_with("/AUDIT.md"),
                "{} has no audit document",
                handoff.ticket
            );
        }
    }

    #[test]
    fn open_children_state_the_evidence_they_owe() {
        for handoff in CHILD_HANDOFFS
            .iter()
            .filter(|handoff| matches!(handoff.status, HandoffStatus::Open))
        {
            assert!(
                handoff.verdict.contains("owed at its own Review"),
                "{} does not name its obligation",
                handoff.ticket
            );
            assert!(handoff.evidence.starts_with("handoff due"));
        }
    }
}
