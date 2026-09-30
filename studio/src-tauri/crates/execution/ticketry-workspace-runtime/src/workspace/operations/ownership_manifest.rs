//! Checked ownership closure for the Workspace Operation journal.
//!
//! The journal has exactly one production writer: the in-process Rust runtime.
//! No Django model, signal, admin action, DAO, migration, fixture, or
//! compatibility handler may create, mutate, or delete these rows. The
//! manifest is not documentation — startup validates the installed schema
//! against it.

use super::schema::OPERATION_COLUMNS;

/// Version of the checked ownership contract.
pub const VERSION: i32 = 1;

/// The tables this capability authors outright, at their checked column shape.
pub const OWNED_TABLES: &[(&str, &[&str])] = &[
    ("workspace_operations", OPERATION_COLUMNS),
    (
        "ticketry_workspace_operations_schema",
        &["singleton", "version", "installed_at"],
    ),
];

/// Every table whose production writer is Rust.
pub fn owned_tables() -> Vec<&'static str> {
    OWNED_TABLES.iter().map(|(table, _)| *table).collect()
}

/// The journal is an internal entity: it has generated SeaORM code but no
/// public generated query or mutation bundle. This is the checked name a
/// schema-surface test asserts against.
pub const PRIVATE_GRAPHQL_TYPE_PREFIX: &str = "WorkspaceOperation";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::super::schema::AUTHORED_TABLES;
    use super::*;

    #[test]
    fn the_manifest_covers_exactly_the_installed_schema() {
        let manifest = owned_tables().into_iter().collect::<BTreeSet<_>>();
        let installed = AUTHORED_TABLES.iter().copied().collect::<BTreeSet<_>>();
        assert_eq!(manifest, installed);
        assert!(OWNED_TABLES.iter().all(|(_, columns)| !columns.is_empty()));
    }
}
