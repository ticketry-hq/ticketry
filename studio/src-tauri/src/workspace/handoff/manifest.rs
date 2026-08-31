//! The one production-writer assignment for every table the Slice 4 cutover
//! transfers.
//!
//! Documents, Worktrees, and the Workspace Operation journal each carry their
//! own capability manifest, because each adopts or authors its own schema. This
//! module is the composition of the three, and it exists to answer the question
//! no single capability can: does exactly one production writer own each table,
//! and does the store in front of us actually have that shape?
//!
//! The answer is enforcement rather than documentation. Startup validates the
//! live schema against this assignment before the write lease changes hands, so
//! an unknown table, a missing table, a drifted column set, or two capabilities
//! claiming one table refuses the handoff while the pre-cutover snapshot is
//! still the recovery path.

use std::collections::{BTreeMap, BTreeSet};

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::{WorkspaceHandoffError, WorkspaceHandoffErrorCode};

/// Version of the composed Slice 4 ownership contract.
pub const VERSION: i32 = 1;

/// Which capability's services are the sole production writer for a table.
///
/// Every variant means the same process — the in-process Rust runtime — so the
/// value is not an authority selector. It names the capability whose code is
/// allowed to write, which is what makes a second claim on one table a
/// detectable error rather than a harmless duplicate.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ProductionWriter {
    /// The Design Document registry services: discovery, refresh, and save.
    Documents,
    /// The Worktree services: create, discard, integrate, and status.
    Worktrees,
    /// The durable Workspace Operation journal shared by both.
    WorkspaceOperations,
}

impl ProductionWriter {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Documents => "documents",
            Self::Worktrees => "worktrees",
            Self::WorkspaceOperations => "workspace-operations",
        }
    }
}

/// The ledger columns both adoption bridges install beside their adopted table.
const ADOPTION_LEDGER_COLUMNS: &[&str] = &[
    "singleton",
    "version",
    "source_leaf",
    "stable_digest",
    "adopted_at",
];

/// Every table the cutover transfers, with the capability that owns its writes
/// and the column shape startup requires.
///
/// The three adopted or authored data tables come first, followed by the
/// ownership ledgers that record the handoff. The ledgers are listed because a
/// missing ledger is exactly how a half-finished adoption looks.
pub const OWNED_TABLES: &[(&str, ProductionWriter, &[&str])] = &[
    (
        "design_documents",
        ProductionWriter::Documents,
        crate::documents::persistence::ownership_manifest::DESIGN_DOCUMENT_COLUMNS,
    ),
    (
        crate::documents::persistence::LEDGER_TABLE,
        ProductionWriter::Documents,
        ADOPTION_LEDGER_COLUMNS,
    ),
    (
        crate::worktree::persistence::ADOPTED_TABLE,
        ProductionWriter::Worktrees,
        WORKTREE_COLUMNS,
    ),
    (
        crate::worktree::persistence::LEDGER_TABLE,
        ProductionWriter::Worktrees,
        ADOPTION_LEDGER_COLUMNS,
    ),
    (
        crate::worktree::persistence::pull_request_url_migration::LEDGER_TABLE,
        ProductionWriter::Worktrees,
        crate::worktree::persistence::ownership_manifest::AUTHORED_TABLES[1].1,
    ),
    (
        "workspace_operations",
        ProductionWriter::WorkspaceOperations,
        OPERATION_COLUMNS,
    ),
    (
        "ticketry_workspace_operations_schema",
        ProductionWriter::WorkspaceOperations,
        &["singleton", "version", "installed_at"],
    ),
];

/// The adopted Worktree index, at the shape the capability manifest declares.
const WORKTREE_COLUMNS: &[&str] =
    crate::worktree::persistence::ownership_manifest::ADOPTED_TABLES[0].1;

/// The authored journal, at the shape the capability manifest declares.
const OPERATION_COLUMNS: &[&str] =
    crate::workspace::operations::ownership_manifest::OWNED_TABLES[0].1;

/// Every table whose production writer is Rust after the Slice 4 handoff.
pub fn owned_tables() -> Vec<&'static str> {
    OWNED_TABLES.iter().map(|(table, _, _)| *table).collect()
}

/// The capability that owns one table's writes, if the manifest names it.
pub fn production_writer(table: &str) -> Option<ProductionWriter> {
    OWNED_TABLES
        .iter()
        .find(|(name, _, _)| *name == table)
        .map(|(_, writer, _)| *writer)
}

/// Prove the assignment itself is well formed before it is used to judge a
/// store: exactly one writer per table, and no table declared without columns.
///
/// This runs at startup rather than only under `cfg(test)` because a build that
/// shipped a malformed manifest must refuse the handoff, not validate a store
/// against a contract that contradicts itself.
pub fn validate_assignment() -> Result<(), WorkspaceHandoffError> {
    let mut writers: BTreeMap<&str, ProductionWriter> = BTreeMap::new();
    for (table, writer, columns) in OWNED_TABLES {
        if columns.is_empty() {
            return Err(malformed(format!(
                "the ownership manifest declares {table} with no column shape"
            )));
        }
        if let Some(existing) = writers.insert(table, *writer) {
            if existing != *writer {
                return Err(malformed(format!(
                    "{table} is claimed by both {} and {}",
                    existing.as_str(),
                    writer.as_str()
                )));
            }
            return Err(malformed(format!(
                "the ownership manifest names {table} twice"
            )));
        }
    }
    Ok(())
}

/// Prove the store in front of us is the store this manifest describes.
///
/// Every named table must exist at exactly the declared column shape. A missing
/// table means an adoption did not complete; an unknown or extra column means a
/// migration this build has never seen already wrote through the schema. Both
/// refuse the handoff rather than enabling a writer over an unrecognised shape.
pub async fn validate_schema(database: &impl ConnectionTrait) -> Result<(), WorkspaceHandoffError> {
    validate_assignment()?;
    for (table, writer, columns) in OWNED_TABLES {
        let observed = observed_columns(database, table).await?;
        if observed.is_empty() {
            return Err(malformed(format!(
                "{table} is missing, so the {} writer cannot be handed its schema",
                writer.as_str()
            )));
        }
        let declared = columns
            .iter()
            .map(|column| (*column).to_owned())
            .collect::<BTreeSet<_>>();
        if observed != declared {
            return Err(malformed(format!(
                "{table} does not have the column shape this build owns"
            )));
        }
    }
    Ok(())
}

async fn observed_columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, WorkspaceHandoffError> {
    // The table name comes from this build's own manifest, never from a caller
    // or a stored payload, so it cannot carry caller text into the statement.
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .map_err(|error| {
            WorkspaceHandoffError::new(
                WorkspaceHandoffErrorCode::Storage,
                format!("could not read the {table} schema: {error}"),
            )
        })?;
    rows.into_iter()
        .map(|row| {
            row.try_get::<String>("", "name").map_err(|error| {
                WorkspaceHandoffError::new(
                    WorkspaceHandoffErrorCode::Storage,
                    format!("could not read a {table} column name: {error}"),
                )
            })
        })
        .collect()
}

fn malformed(message: impl Into<String>) -> WorkspaceHandoffError {
    WorkspaceHandoffError::new(WorkspaceHandoffErrorCode::UnknownSchema, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_one_capability_owns_each_transferred_table() {
        validate_assignment().expect("the shipped assignment must be well formed");

        let tables = owned_tables();
        let unique = tables.iter().collect::<BTreeSet<_>>();
        assert_eq!(tables.len(), unique.len());
    }

    #[test]
    fn the_composition_covers_every_capability_manifest() {
        for table in crate::documents::persistence::ownership_manifest::owned_tables() {
            assert_eq!(production_writer(table), Some(ProductionWriter::Documents));
        }
        for table in crate::worktree::persistence::ownership_manifest::owned_tables() {
            assert_eq!(production_writer(table), Some(ProductionWriter::Worktrees));
        }
        for table in crate::workspace::operations::ownership_manifest::owned_tables() {
            assert_eq!(
                production_writer(table),
                Some(ProductionWriter::WorkspaceOperations)
            );
        }
    }

    #[test]
    fn both_adoption_ledgers_are_owned_alongside_their_table() {
        assert_eq!(
            production_writer(crate::documents::persistence::LEDGER_TABLE),
            Some(ProductionWriter::Documents)
        );
        assert_eq!(
            production_writer(crate::worktree::persistence::LEDGER_TABLE),
            Some(ProductionWriter::Worktrees)
        );
    }

    #[test]
    fn a_table_this_build_does_not_own_is_not_claimed() {
        for table in ["work_items", "agent_runs", "app_settings"] {
            assert_eq!(production_writer(table), None);
        }
    }
}
