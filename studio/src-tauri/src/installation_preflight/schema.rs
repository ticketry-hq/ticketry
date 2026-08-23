//! Which tables and columns the read view actually has.
//!
//! Preflight runs the same rule list against every supported generation, and
//! those generations differ: an installation from an early Django leaf has no
//! worktrees table, and one from a later leaf has the table but not yet the
//! column a rule reads. A rule that names what it needs can therefore be
//! reported as not applicable instead of failing to run, which is what lets one
//! reviewed list of rules cover the whole support policy.

use std::collections::{BTreeMap, BTreeSet};

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::error::{PreflightError, PreflightFailure};

/// The tables and columns present in one installation.
#[derive(Debug, Default)]
pub struct Schema {
    tables: BTreeMap<String, BTreeSet<String>>,
}

impl Schema {
    /// Read the shape of the installation behind `view`.
    ///
    /// # Errors
    ///
    /// Returns [`PreflightFailure::UnreadableInstallation`] when the schema
    /// cannot be listed.
    pub async fn read<C: ConnectionTrait>(view: &C) -> Result<Self, PreflightError> {
        let names = crate::installation_classification::schema_facts::table_names(view)
            .await
            .map_err(|error| {
                unreadable(format!("could not list the installation's tables: {error}"))
            })?;
        let mut tables = BTreeMap::new();
        for name in names {
            let quoted = name.replace('\'', "''");
            let rows = view
                .query_all_raw(Statement::from_string(
                    DbBackend::Sqlite,
                    format!("PRAGMA table_xinfo('{quoted}')"),
                ))
                .await
                .map_err(|error| {
                    unreadable(format!("could not read the columns of a table: {error}"))
                })?;
            let mut columns = BTreeSet::new();
            for row in rows {
                columns.insert(row.try_get::<String>("", "name").map_err(|error| {
                    unreadable(format!("could not read a column name: {error}"))
                })?);
            }
            tables.insert(name, columns);
        }
        Ok(Self { tables })
    }

    /// Whether a table exists.
    #[must_use]
    pub fn has_table(&self, table: &str) -> bool {
        self.tables.contains_key(table)
    }

    /// Whether one requirement — `table` or `table.column` — is satisfied.
    #[must_use]
    pub fn satisfies(&self, requirement: &str) -> bool {
        match requirement.split_once('.') {
            Some((table, column)) => self
                .tables
                .get(table)
                .is_some_and(|columns| columns.contains(column)),
            None => self.has_table(requirement),
        }
    }

    /// Every table name, for evidence and for a coverage assertion.
    #[must_use]
    pub fn table_names(&self) -> Vec<&str> {
        self.tables.keys().map(String::as_str).collect()
    }
}

fn unreadable(detail: String) -> PreflightError {
    PreflightError::new(PreflightFailure::UnreadableInstallation, detail)
}
