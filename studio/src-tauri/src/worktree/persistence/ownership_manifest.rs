//! Checked ownership closure for the adopted Worktree index.
//!
//! Every resource named here has exactly one production writer after the Slice
//! 4 cutover: the in-process Rust runtime. Adoption validates the observed
//! schema against this manifest, so the manifest is enforcement rather than
//! documentation.

use super::schema::{LEDGER_TABLE, WORKTREE_COLUMNS};

/// Version of the checked Worktree ownership contract.
pub const VERSION: i32 = 1;

/// The adopted Django table, at its post-adoption column shape.
pub const ADOPTED_TABLES: &[(&str, &[&str])] = &[("worktrees", WORKTREE_COLUMNS)];

/// The focused table this slice authors outright.
pub const AUTHORED_TABLES: &[(&str, &[&str])] = &[(
    LEDGER_TABLE,
    &[
        "singleton",
        "version",
        "source_leaf",
        "stable_digest",
        "adopted_at",
    ],
)];

/// Every Worktree column a public GraphQL input may never submit or patch.
///
/// Each of these is derived by the Worktree application service from Work
/// Management data, the selected profile's repository, or external Git
/// evidence. A caller supplies only the Work Item identity and the operation
/// identity; repository roots, checkout paths, branch and base identities,
/// lifecycle state, timestamps, and the ephemeral flag are server-owned. The
/// policy is applied centrally in [`super::column_policy`] so a later
/// registration change cannot quietly widen the public write surface.
pub const PROTECTED_COLUMNS: &[&str] = &[
    "id",
    "workspace_slug",
    "project_id",
    "module_id",
    "ticket_seq",
    "repo_root",
    "path",
    "branch",
    "base_branch",
    "base_commit",
    "status",
    "ephemeral",
    "created_at",
    "updated_at",
];

/// Why the generated Worktree mutation bundle stays private in Seaography
/// `2.0.0-rc.9`, audited across all four generated writes together.
///
/// * Create-one and create-batch would accept caller-supplied checkout paths,
///   branches, and base commits, and cannot derive the top-level owner, hold
///   the per-repository lock, prepare a durable Workspace Operation, or prove
///   with Git that the expected tree exists before the row is inserted.
/// * Update runs `Entity::update_many` and executes neither
///   `before_active_model_save` nor SeaORM `before_save`, so no hook can keep
///   the stored path, branch, base ref, and lifecycle state consistent with
///   Git.
/// * Delete runs `Entity::delete_many` and executes neither
///   `before_delete` nor `after_delete`, so a row could be dropped while its
///   checkout and task branch still exist on disk.
///
/// Registration is all-or-nothing per entity in rc.9, so one unsafe write keeps
/// the whole bundle private. Reads, relations, filtering, ordering, pagination,
/// and outputs remain fully generated.
pub const GENERATED_MUTATION_GAPS: &[&str] = &[
    "create-one: caller-submitted derived identity, no repository lock, no Git evidence",
    "create-batch: same as create-one, multiplied across rows in one transaction",
    "update: no before_active_model_save and no SeaORM before_save in rc.9",
    "delete: no SeaORM before_delete/after_delete in rc.9",
];

/// Every table whose production writer is Rust after the Worktree handoff.
pub fn owned_tables() -> Vec<&'static str> {
    ADOPTED_TABLES
        .iter()
        .chain(AUTHORED_TABLES.iter())
        .map(|(table, _)| *table)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

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
    fn every_worktree_column_is_protected_except_the_owning_work_item() {
        let protected = PROTECTED_COLUMNS.iter().collect::<BTreeSet<_>>();
        let caller_writable = WORKTREE_COLUMNS
            .iter()
            .filter(|column| !protected.contains(column))
            .collect::<Vec<_>>();
        assert_eq!(caller_writable, vec![&"task_id"]);
    }

    #[test]
    fn the_four_generated_writes_are_audited_together() {
        for operation in ["create-one", "create-batch", "update", "delete"] {
            assert!(
                GENERATED_MUTATION_GAPS
                    .iter()
                    .any(|gap| gap.starts_with(operation)),
                "missing recorded rc.9 gap for {operation}"
            );
        }
    }
}
