//! Checked ownership closure for the typed Module Link.
//!
//! Both tables have exactly one production writer: the in-process Rust
//! runtime. No Django model, migration, fixture, or compatibility handler may
//! create, mutate, or delete these rows, and no profile file is authoritative
//! for a Module's folder once a link exists. The manifest is enforcement
//! rather than documentation — [`super::schema::verify`] validates the
//! installed schema against it.

use super::schema::{LINK_COLUMNS, LINK_TABLE, SCHEMA_COLUMNS, SCHEMA_TABLE};

/// Version of the checked ownership contract.
pub const VERSION: i32 = 1;

/// The tables this capability authors outright, at their checked column shape.
pub const OWNED_TABLES: &[(&str, &[&str])] = &[
    (LINK_TABLE, LINK_COLUMNS),
    (SCHEMA_TABLE, SCHEMA_COLUMNS),
];

/// The legacy asset the importer reads and never rewrites, moves, or removes.
///
/// Retiring it belongs to the later slice that removes profile-based startup,
/// and that slice may only act once a committed receipt names the rows that
/// replaced it.
pub const READ_ONLY_LEGACY_ASSET: &str = super::legacy_source::LIVE_PROFILES;

/// The artifact the importer authors beside the installation's data.
pub const IMPORT_ARTIFACT: &str = super::receipt::RECEIPT_FILE;

/// Every Module Link column a public write may never submit or patch.
///
/// A caller names the Module it is linking and the folder to record. Identity
/// is derived from the Module and both timestamps are server-owned, so the one
/// caller-writable column is `path`.
pub const PROTECTED_COLUMNS: &[&str] = &["id", "module_id", "created_at", "updated_at"];

/// Every table whose production writer is Rust.
#[must_use]
pub fn owned_tables() -> Vec<&'static str> {
    OWNED_TABLES.iter().map(|(table, _)| *table).collect()
}

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

    #[test]
    fn the_only_caller_writable_column_is_the_local_path() {
        let protected = PROTECTED_COLUMNS.iter().collect::<BTreeSet<_>>();
        let writable = LINK_COLUMNS
            .iter()
            .filter(|column| !protected.contains(column))
            .collect::<Vec<_>>();
        assert_eq!(writable, vec![&"path"]);
    }
}
