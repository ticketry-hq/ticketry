//! What the installation held, in a form two databases can be compared by.
//!
//! Adoption preserves everything, so the only honest proof that it did is a
//! before-and-after comparison over every product table. Counts catch a lost
//! row. They do not catch a rewritten identity, a regenerated rank, a
//! re-serialized timestamp, or a boolean that changed representation on its way
//! through a type map — and those are precisely the losses this migration is at
//! risk of, because every one of them looks like a successful adoption.
//!
//! So the inventory also carries a digest per table over every stored value.
//! `quote()` is the canonical form: it renders integers, reals, text, blobs,
//! and NULL as distinct, exactly reversible SQL literals, which is what makes
//! "the same rows" checkable rather than approximate. Rows are ordered by that
//! rendered form rather than by a primary key, so the digest is defined for
//! every table including the join tables that have no single key column.

use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::classification::schema_facts;

/// Counts and digests for one database, keyed by product table.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    /// Rows per product table.
    pub counts: BTreeMap<String, u64>,
    /// The canonical preserved-field digest per product table.
    pub digests: BTreeMap<String, String>,
}

impl Inventory {
    /// The single digest covering every table, for one-line evidence.
    #[must_use]
    pub fn combined_digest(&self) -> String {
        let mut hasher = Sha256::new();
        for (table, digest) in &self.digests {
            hasher.update(table.as_bytes());
            hasher.update(b"=");
            hasher.update(digest.as_bytes());
            hasher.update(b"\n");
        }
        hex(&hasher.finalize())
    }

    /// Every table whose count or digest differs, with both sides named.
    #[must_use]
    pub fn differences(&self, other: &Self) -> Vec<String> {
        let mut differences = Vec::new();
        let mut tables = self.counts.keys().collect::<Vec<_>>();
        tables.extend(other.counts.keys());
        tables.sort_unstable();
        tables.dedup();
        for table in tables {
            match (self.counts.get(table), other.counts.get(table)) {
                (Some(before), Some(after)) if before != after => {
                    differences.push(format!("{table}: {before} row(s) became {after}"));
                }
                (Some(_), None) => differences.push(format!("{table}: table is gone")),
                (None, Some(_)) => differences.push(format!("{table}: table appeared")),
                _ => {}
            }
            if let (Some(before), Some(after)) = (self.digests.get(table), other.digests.get(table))
            {
                if before != after {
                    differences.push(format!("{table}: preserved values changed"));
                }
            }
        }
        differences
    }
}

/// Read the inventory of every product table in `database`.
pub async fn read<C: ConnectionTrait>(database: &C) -> Result<Inventory, String> {
    let mut inventory = Inventory::default();
    for table in product_tables(database).await? {
        let columns = column_names(database, &table).await?;
        if columns.is_empty() {
            continue;
        }
        inventory
            .counts
            .insert(table.clone(), count(database, &table).await?);
        inventory
            .digests
            .insert(table.clone(), digest(database, &table, &columns).await?);
    }
    Ok(inventory)
}

/// The product tables present, excluding framework and Rust bookkeeping.
///
/// Ledger tables are deliberately outside the comparison: adoption is expected
/// to add them, and a table whose appearance is the point cannot also be the
/// evidence that nothing appeared.
pub(crate) async fn product_tables<C: ConnectionTrait>(
    database: &C,
) -> Result<Vec<String>, String> {
    Ok(schema_facts::table_names(database)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|name| schema_facts::is_product_table(name))
        .collect())
}

async fn count<C: ConnectionTrait>(database: &C, table: &str) -> Result<u64, String> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS row_total FROM \"{table}\""),
        ))
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("counting {table} returned no row"))?;
    let counted = row
        .try_get::<i64>("", "row_total")
        .map_err(|error| error.to_string())?;
    Ok(counted.max(0).unsigned_abs())
}

async fn digest<C: ConnectionTrait>(
    database: &C,
    table: &str,
    columns: &[String],
) -> Result<String, String> {
    let rendered = columns
        .iter()
        .map(|column| format!("quote(\"{column}\")"))
        .collect::<Vec<_>>()
        .join(" || '|' || ");
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT {rendered} AS preserved FROM \"{table}\" ORDER BY preserved"),
        ))
        .await
        .map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(table.as_bytes());
    hasher.update(b"\n");
    for row in rows {
        // A row whose every column is NULL renders as a literal, never as an
        // absent value, so `quote()` cannot collapse two different rows.
        let preserved = row
            .try_get::<Option<String>>("", "preserved")
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        hasher.update(preserved.as_bytes());
        hasher.update(b"\n");
    }
    Ok(hex(&hasher.finalize()))
}

async fn column_names<C: ConnectionTrait>(
    database: &C,
    table: &str,
) -> Result<Vec<String>, String> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .map_err(|error| error.to_string())?;
    rows.into_iter()
        .map(|row| {
            row.try_get::<String>("", "name")
                .map_err(|error| error.to_string())
        })
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::Inventory;
    use std::collections::BTreeMap;

    fn inventory(rows: u64, digest: &str) -> Inventory {
        Inventory {
            counts: BTreeMap::from([("worktracker_issue".to_owned(), rows)]),
            digests: BTreeMap::from([("worktracker_issue".to_owned(), digest.to_owned())]),
        }
    }

    #[test]
    fn an_equal_inventory_reports_no_difference() {
        assert!(inventory(3, "a").differences(&inventory(3, "a")).is_empty());
    }

    #[test]
    fn a_lost_row_is_named_with_both_counts() {
        let differences = inventory(3, "a").differences(&inventory(2, "a"));
        assert_eq!(differences, vec!["worktracker_issue: 3 row(s) became 2"]);
    }

    #[test]
    fn a_rewritten_value_is_caught_when_the_count_is_unchanged() {
        let differences = inventory(3, "a").differences(&inventory(3, "b"));
        assert_eq!(
            differences,
            vec!["worktracker_issue: preserved values changed"]
        );
    }

    #[test]
    fn the_combined_digest_changes_with_any_table_digest() {
        assert_ne!(
            inventory(3, "a").combined_digest(),
            inventory(3, "b").combined_digest()
        );
    }
}
