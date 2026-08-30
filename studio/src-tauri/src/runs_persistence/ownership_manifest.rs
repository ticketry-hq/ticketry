//! Checked ownership closure for the Slice 3 Runs handoff.
//!
//! Every resource named here has exactly one production writer after cutover:
//! the in-process Rust runtime. The manifest is not documentation — startup
//! validates the adopted schema against it, and the Python boundary refuses to
//! write anything it lists.

use super::schema::AGENT_RUN_COLUMNS;

/// Version of the checked Slice 3 ownership contract.
pub const VERSION: i32 = 1;

/// The two adopted Django tables, at their post-bridge column shape.
pub const ADOPTED_TABLES: &[(&str, &[&str])] = &[
    ("agent_runs", AGENT_RUN_COLUMNS),
    ("automation_attempts", ATTEMPT_COLUMNS),
];

/// `automation_attempts` after every known bridge has run. The base columns
/// predate the launch-rejection and dismissal generations.
pub const ATTEMPT_COLUMNS: &[&str] = &[
    "id",
    "transition_id",
    "issue_id",
    "from_state_id",
    "to_state_id",
    "workflow_revision",
    "status",
    "agent",
    "agent_run_id",
    "error",
    "retry_of_id",
    "root_attempt_id",
    "created_at",
    "updated_at",
    "error_details",
    "retryable",
    "dismissed_at",
];

/// The focused tables this slice authors outright. They have never had a
/// Django writer and never will.
pub const AUTHORED_TABLES: &[(&str, &[&str])] = &[
    (
        "runs_status_events",
        &[
            "cursor",
            "event_id",
            "project_id",
            "event_kind",
            "payload_version",
            "subject_kind",
            "subject_id",
            "agent_run_id",
            "automation_attempt_id",
            "work_item_id",
            "payload",
            "committed_at",
        ],
    ),
    (
        "runs_project_compaction_watermarks",
        &["project_id", "compacted_through_cursor", "updated_at"],
    ),
    (
        "runs_launch_effects",
        &[
            "effect_id",
            "intent_version",
            "agent_run_id",
            "automation_attempt_id",
            "request_id",
            "project_id",
            "issue_id",
            "scope",
            "provider",
            "target_kind",
            "target_id",
            "policy_reference",
            "state",
            "lease_owner",
            "lease_expires_at",
            "attempt_count",
            "last_error_code",
            "last_error_message",
            "runtime_evidence",
            "created_at",
            "updated_at",
            "applied_at",
        ],
    ),
];

/// Every table whose production writer is Rust after the Slice 3 handoff.
pub fn owned_tables() -> Vec<&'static str> {
    ADOPTED_TABLES
        .iter()
        .chain(AUTHORED_TABLES.iter())
        .map(|(table, _)| *table)
        .collect()
}

/// The only Python modules allowed to touch Runs behaviour in shipping. They
/// provide one read projection, two Rust-forwarding authorization seams, and
/// the fail-closed ownership guard; none is a Runs-table writer.
pub const DJANGO_COMPATIBILITY_PORTS: &[&str] = &[
    "apps.runs.api",
    "apps.runs.authorization",
    "apps.runs.dao.activity",
    "apps.runs.write_ownership",
];

/// The Django environment flag that installs the refusal at the Python
/// boundary. Packaged startup sets it before the sidecar is launched.
pub const DJANGO_OWNER_ENV: &str = "TICKETRY_RUST_SLICE3_OWNER";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::runs_persistence::schema::ATTEMPT_BASE_COLUMNS;

    #[test]
    fn manifest_has_one_unique_entry_for_every_owned_resource() {
        let tables = owned_tables().into_iter().collect::<BTreeSet<_>>();
        assert_eq!(tables.len(), ADOPTED_TABLES.len() + AUTHORED_TABLES.len());
        assert!(ADOPTED_TABLES
            .iter()
            .chain(AUTHORED_TABLES.iter())
            .all(|(_, columns)| !columns.is_empty()));
    }

    #[test]
    fn the_manifest_covers_exactly_the_adopted_runs_schema() {
        let manifest = owned_tables().into_iter().collect::<BTreeSet<_>>();
        let installed = super::super::schema::AUTHORED_TABLES
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(manifest, installed);
    }

    #[test]
    fn adopted_attempt_columns_extend_the_base_shape() {
        for column in ATTEMPT_BASE_COLUMNS {
            assert!(ATTEMPT_COLUMNS.contains(column), "missing {column}");
        }
        assert!(AGENT_RUN_COLUMNS.contains(&"provider_session_id"));
    }

    #[test]
    fn agent_run_manifest_matches_the_installed_launch_snapshot_shape() {
        for column in ["initial_prompt", "launch_reasoning", "launch_unattended"] {
            assert!(AGENT_RUN_COLUMNS.contains(&column), "missing {column}");
        }
        assert!(!AGENT_RUN_COLUMNS.contains(&"model"));
        assert!(!AGENT_RUN_COLUMNS.contains(&"reasoning"));
    }
}
