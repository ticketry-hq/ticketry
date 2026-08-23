//! Checked ownership transfer for terminal persistence.

use super::schema::{
    CLEANUP_EFFECT_COLUMNS, LAUNCH_MATERIAL_COLUMNS, LAUNCH_REQUEST_COLUMNS, LEASE_COLUMNS,
    LEDGER_TABLE, SESSION_COLUMNS,
};

pub const VERSION: i32 = 1;
pub const ADOPTED_TABLES: &[(&str, &[&str])] = &[
    ("agent_terminal_sessions", SESSION_COLUMNS),
    ("agent_run_viewer_leases", LEASE_COLUMNS),
    ("terminal_launch_requests", LAUNCH_REQUEST_COLUMNS),
];
pub const AUTHORED_TABLES: &[(&str, &[&str])] = &[
    ("terminal_launch_material", LAUNCH_MATERIAL_COLUMNS),
    ("terminal_cleanup_effects", CLEANUP_EFFECT_COLUMNS),
    (
        LEDGER_TABLE,
        &[
            "singleton",
            "version",
            "source_leaf",
            "schema_fingerprint",
            "session_digest",
            "launch_request_digest",
            "adopted_at",
        ],
    ),
];

/// The generated bundle is all-or-nothing in Seaography rc.9. Every terminal
/// model write stays private until the later identity-bound lifecycle tickets.
///
/// These four entries state the blocker per generated write for the adoption
/// boundary as a whole. The per-entity blockers, the custom fields that replace
/// them, and the aggregate Slice 5 verdict live in
/// [`super::aggregate_seaography_audit`].
pub const GENERATED_MUTATION_GAPS: &[&str] = &[
    "create-one: launch requires an atomic Agent Run and Runs Launch Effect plus a verified tmux effect",
    "create-batch: multiple external launches cannot be exposed as flat row inserts",
    "update: rc.9 bypasses pre-save hooks needed to serialize termination, lease generation, and Runs facts",
    "delete: rc.9 bypasses delete hooks and could erase durable history or unverified runtime ownership",
];

pub const SESSION_PROTECTED_COLUMNS: &[&str] = SESSION_COLUMNS;
pub const LEASE_PROTECTED_COLUMNS: &[&str] = LEASE_COLUMNS;

pub fn owned_tables() -> Vec<&'static str> {
    ADOPTED_TABLES
        .iter()
        .chain(AUTHORED_TABLES.iter())
        .map(|(table, _)| *table)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn manifest_assigns_every_table_once() {
        let tables = owned_tables();
        assert_eq!(tables.iter().collect::<BTreeSet<_>>().len(), tables.len());
    }

    #[test]
    fn all_four_generated_writes_have_a_recorded_blocker() {
        for operation in ["create-one", "create-batch", "update", "delete"] {
            assert!(GENERATED_MUTATION_GAPS
                .iter()
                .any(|gap| gap.starts_with(operation)));
        }
    }

    /// A generic blocker is not evidence on its own. Each generated write must
    /// also be blocked per registered entity in the aggregate audit record.
    #[test]
    fn every_generic_blocker_has_per_entity_evidence() {
        use crate::terminal_persistence::aggregate_seaography_audit::{
            GENERATED_WRITES, REGISTERED_ENTITIES,
        };

        for (index, write) in GENERATED_WRITES.iter().enumerate() {
            assert!(GENERATED_MUTATION_GAPS
                .iter()
                .any(|gap| gap.starts_with(write)));
            for entity in REGISTERED_ENTITIES {
                assert!(
                    !entity.blockers[index].is_empty(),
                    "{} records no {write} blocker",
                    entity.entity
                );
            }
        }
    }
}
