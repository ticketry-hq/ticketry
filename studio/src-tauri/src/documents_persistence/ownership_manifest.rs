//! Checked ownership closure for the Design Document registry.
//!
//! Adoption validates the live schema against this manifest, and the Python
//! boundary refuses to write anything it names. The manifest is deliberately
//! small: this ticket adopts one table. Worktrees and the Workspace Operation
//! journal carry their own manifests.

/// Version of the checked Documents ownership contract.
pub const VERSION: i32 = 1;

/// The adopted Django table, at its post-bridge column shape.
pub const ADOPTED_TABLES: &[(&str, &[&str])] = &[("design_documents", DESIGN_DOCUMENT_COLUMNS)];

/// `design_documents` once the bridge has added the lazily populated digest.
pub const DESIGN_DOCUMENT_COLUMNS: &[&str] = &[
    "id",
    "module_id",
    "task_id",
    "scope",
    "root_dir",
    "rel_path",
    "discovered_by_run_id",
    "created_at",
    "updated_at",
    "content_digest",
];

/// Columns a public GraphQL contract may never carry as caller input, and — for
/// the two authority columns — may never expose as output either. The entity
/// removes `root_dir` and `discovered_by_run_id` from the generated contract
/// outright; the remainder are server-owned identities, derived scope, and
/// timestamps that only the Documents services may set.
pub const PROTECTED_COLUMNS: &[&str] = &[
    "id",
    "module_id",
    "task_id",
    "scope",
    "root_dir",
    "rel_path",
    "discovered_by_run_id",
    "created_at",
    "updated_at",
    "content_digest",
];

/// The two columns that are authority rather than data: an absolute authorized
/// root and the provenance of the run that registered the row. Neither appears
/// anywhere in the public GraphQL contract.
pub const INTERNAL_ONLY_COLUMNS: &[&str] = &["root_dir", "discovered_by_run_id"];

/// Every table whose production writer is Rust after the Documents handoff.
pub fn owned_tables() -> Vec<&'static str> {
    ADOPTED_TABLES.iter().map(|(table, _)| *table).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::super::schema::{ADOPTED_COLUMN, DJANGO_COLUMNS};
    use super::*;

    #[test]
    fn the_manifest_covers_exactly_the_adopted_documents_schema() {
        let manifest = owned_tables().into_iter().collect::<BTreeSet<_>>();
        let installed = super::super::schema::AUTHORED_TABLES
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(manifest, installed);
    }

    #[test]
    fn adopted_columns_extend_the_django_shape_by_exactly_the_digest() {
        for column in DJANGO_COLUMNS {
            assert!(DESIGN_DOCUMENT_COLUMNS.contains(column), "missing {column}");
        }
        assert_eq!(DESIGN_DOCUMENT_COLUMNS.len(), DJANGO_COLUMNS.len() + 1);
        assert!(DESIGN_DOCUMENT_COLUMNS.contains(&ADOPTED_COLUMN));
    }

    #[test]
    fn every_adopted_column_is_protected_from_caller_input() {
        for column in DESIGN_DOCUMENT_COLUMNS {
            assert!(
                PROTECTED_COLUMNS.contains(column),
                "{column} is not centrally protected"
            );
        }
        for column in INTERNAL_ONLY_COLUMNS {
            assert!(PROTECTED_COLUMNS.contains(column));
        }
    }
}
