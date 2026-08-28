//! Read the semantic shape of a SQLite installation, without changing it.
//!
//! Table names alone cannot tell a supported generation from a lookalike, so
//! classification compares affinities, nullability, defaults, primary keys,
//! foreign-key actions, index membership, and table checks. Every fact here is
//! read through PRAGMA queries on a read-only connection.

use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, DbBackend, DbErr, Statement};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// `[name, affinity, not_null, default, primary_key_position, hidden]`.
pub type ColumnFact = (String, String, bool, Option<String>, i64, i64);
/// `[from, table, to, on_update, on_delete, match, deferred]`.
pub type ForeignKeyFact = (String, String, Option<String>, String, String, String, bool);
/// `[column, descending, collation]`.
pub type IndexMemberFact = (Option<String>, bool, Option<String>);
/// `[name, unique, origin, partial_predicate, members]`.
pub type IndexFact = (String, bool, String, Option<String>, Vec<IndexMemberFact>);

/// The reviewed semantic facts of one product table.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct TableFacts {
    /// Normalized table-level CHECK expressions, sorted.
    pub checks: Vec<String>,
    /// Column facts in ordinal order.
    pub columns: Vec<ColumnFact>,
    /// Foreign-key facts in stable semantic order.
    pub foreign_keys: Vec<ForeignKeyFact>,
    /// Index facts by index name.
    pub indexes: Vec<IndexFact>,
}

/// Product tables keyed by name, which is what a fingerprint is taken over.
pub type ProductSchema = BTreeMap<String, TableFacts>;

/// Framework bookkeeping Ticketry keeps but does not own.
const FRAMEWORK_PREFIXES: [&str; 3] = ["django_", "auth_", "sqlite_"];
/// Rust's own ledgers, which are ownership evidence rather than product state.
const RUST_PREFIX: &str = "ticketry_";
/// Non-Django migration ledgers, also evidence rather than product state.
const LEDGER_TABLES: [&str; 1] = ["alembic_version"];

/// Whether a table holds product state rather than bookkeeping.
#[must_use]
pub fn is_product_table(name: &str) -> bool {
    !(FRAMEWORK_PREFIXES
        .iter()
        .any(|prefix| name.starts_with(prefix))
        || name.starts_with(RUST_PREFIX)
        || LEDGER_TABLES.contains(&name))
}

/// Read every product table's semantic facts from a read-only connection.
pub async fn read<C: ConnectionTrait>(database: &C) -> Result<ProductSchema, DbErr> {
    let mut schema = ProductSchema::new();
    for (name, sql) in table_definitions(database).await? {
        if !is_product_table(&name) {
            continue;
        }
        let facts = table_facts(database, &name, &sql).await?;
        schema.insert(name, facts);
    }
    Ok(schema)
}

/// Every table name present, product or not.
pub async fn table_names<C: ConnectionTrait>(database: &C) -> Result<Vec<String>, DbErr> {
    Ok(table_definitions(database)
        .await?
        .into_iter()
        .map(|(name, _)| name)
        .collect())
}

async fn table_definitions<C: ConnectionTrait>(
    database: &C,
) -> Result<Vec<(String, String)>, DbErr> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name".to_owned(),
        ))
        .await?;
    let mut definitions = Vec::with_capacity(rows.len());
    for row in rows {
        let name = row.try_get::<String>("", "name")?;
        let sql = row
            .try_get::<Option<String>>("", "sql")?
            .unwrap_or_default();
        definitions.push((name, sql));
    }
    Ok(definitions)
}

async fn table_facts<C: ConnectionTrait>(
    database: &C,
    name: &str,
    sql: &str,
) -> Result<TableFacts, DbErr> {
    let quoted = name.replace('\'', "''");
    let mut columns = Vec::new();
    for row in pragma(database, &format!("PRAGMA table_xinfo('{quoted}')")).await? {
        let declared = row.try_get::<String>("", "type")?;
        columns.push((
            row.try_get::<String>("", "name")?,
            affinity(&declared).to_owned(),
            row.try_get::<i64>("", "notnull")? == 1,
            row.try_get::<Option<String>>("", "dflt_value")?,
            row.try_get::<i64>("", "pk")?,
            row.try_get::<i64>("", "hidden")?,
        ));
    }

    let deferred = sql
        .to_ascii_uppercase()
        .contains("DEFERRABLE INITIALLY DEFERRED");
    let mut foreign_keys: Vec<ForeignKeyFact> = Vec::new();
    for row in pragma(database, &format!("PRAGMA foreign_key_list('{quoted}')")).await? {
        foreign_keys.push((
            row.try_get::<String>("", "from")?,
            row.try_get::<String>("", "table")?,
            row.try_get::<Option<String>>("", "to")?,
            row.try_get::<String>("", "on_update")?,
            row.try_get::<String>("", "on_delete")?,
            row.try_get::<String>("", "match")?,
            deferred,
        ));
    }
    foreign_keys.sort_by_key(foreign_key_order);

    let mut indexes: Vec<IndexFact> = Vec::new();
    for row in pragma(database, &format!("PRAGMA index_list('{quoted}')")).await? {
        let index_name = row.try_get::<String>("", "name")?;
        let predicate = if row.try_get::<i64>("", "partial")? == 1 {
            index_definition(database, &index_name)
                .await?
                .as_deref()
                .and_then(partial_predicate)
        } else {
            None
        };
        let quoted_index = index_name.replace('\'', "''");
        let mut members = Vec::new();
        for member in pragma(database, &format!("PRAGMA index_xinfo('{quoted_index}')")).await? {
            if member.try_get::<i64>("", "key")? != 1 {
                continue;
            }
            members.push((
                member.try_get::<Option<String>>("", "name")?,
                member.try_get::<i64>("", "desc")? == 1,
                member.try_get::<Option<String>>("", "coll")?,
            ));
        }
        indexes.push((
            index_name,
            row.try_get::<i64>("", "unique")? == 1,
            row.try_get::<String>("", "origin")?,
            predicate,
            members,
        ));
    }
    indexes.sort_by(|left, right| left.0.cmp(&right.0));

    Ok(TableFacts {
        checks: extract_checks(sql),
        columns,
        foreign_keys,
        indexes,
    })
}

fn foreign_key_order(
    fact: &ForeignKeyFact,
) -> (String, String, String, String, String, String, bool) {
    (
        fact.0.clone(),
        fact.1.clone(),
        fact.2.clone().unwrap_or_default(),
        fact.3.clone(),
        fact.4.clone(),
        fact.5.clone(),
        fact.6,
    )
}

async fn pragma<C: ConnectionTrait>(
    database: &C,
    statement: &str,
) -> Result<Vec<sea_orm::QueryResult>, DbErr> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            statement.to_owned(),
        ))
        .await
}

async fn index_definition<C: ConnectionTrait>(
    database: &C,
    name: &str,
) -> Result<Option<String>, DbErr> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
            [name.into()],
        ))
        .await?;
    row.map_or(Ok(None), |row| row.try_get::<Option<String>>("", "sql"))
}

fn affinity(declared: &str) -> &'static str {
    let value = declared.to_ascii_uppercase();
    if value.contains("INT") {
        "INTEGER"
    } else if ["CHAR", "CLOB", "TEXT"]
        .iter()
        .any(|token| value.contains(token))
    {
        "TEXT"
    } else if value.is_empty() || value.contains("BLOB") {
        "BLOB"
    } else if ["REAL", "FLOA", "DOUB"]
        .iter()
        .any(|token| value.contains(token))
    {
        "REAL"
    } else {
        "NUMERIC"
    }
}

fn partial_predicate(sql: &str) -> Option<String> {
    let upper = sql.to_ascii_uppercase();
    upper
        .find(" WHERE ")
        .map(|position| normalize(&sql[position + " WHERE ".len()..]))
}

fn normalize(expression: &str) -> String {
    expression
        .replace('"', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_checks(sql: &str) -> Vec<String> {
    let upper = sql.to_ascii_uppercase();
    let mut checks = Vec::new();
    let mut offset = 0;
    while let Some(relative) = upper[offset..].find("CHECK") {
        let position = offset + relative;
        let Some(start_relative) = sql[position..].find('(') else {
            break;
        };
        let start = position + start_relative;
        let mut depth = 0_i32;
        let mut end = None;
        for (index, character) in sql[start..].char_indices() {
            match character {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(start + index);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(end) = end else {
            break;
        };
        checks.push(normalize(&sql[start + 1..end]));
        offset = end + 1;
    }
    checks.sort();
    checks
}

/// The checked schema fingerprint of a product schema.
///
/// The manifest generator computes the same value from the same canonical form,
/// so a fingerprint recorded by Django's migrations and one observed by Rust are
/// comparable. [`canonical`] fixes that form: compact JSON with sorted object
/// keys.
#[must_use]
pub fn fingerprint(schema: &ProductSchema) -> String {
    let value = serde_json::json!({ "tables": schema });
    let mut hasher = Sha256::new();
    hasher.update(canonical(&value).as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Serialize compactly with object keys in sorted order.
fn canonical(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(entries) => {
            let mut keys = entries.keys().collect::<Vec<_>>();
            keys.sort();
            let body = keys
                .into_iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::Value::String(key.clone()),
                        canonical(&entries[key])
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
        serde_json::Value::Array(items) => {
            let body = items.iter().map(canonical).collect::<Vec<_>>().join(",");
            format!("[{body}]")
        }
        other => other.to_string(),
    }
}

/// Name the first semantic difference between two tables, for a safe refusal.
#[must_use]
pub fn difference(expected: &TableFacts, observed: &TableFacts) -> &'static str {
    if expected.columns != observed.columns {
        "column affinity, nullability, default, or primary-key facts changed"
    } else if expected.foreign_keys != observed.foreign_keys {
        "foreign-key target, action, or deferral facts changed"
    } else if expected.indexes != observed.indexes {
        "unique or index membership changed"
    } else {
        "table CHECK constraints changed"
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical, fingerprint, ProductSchema, TableFacts};

    #[test]
    fn canonical_form_sorts_keys_and_drops_whitespace() {
        let value = serde_json::json!({"b": 1, "a": [true, null, "x"]});
        assert_eq!(canonical(&value), r#"{"a":[true,null,"x"],"b":1}"#);
    }

    #[test]
    fn fingerprint_changes_with_any_semantic_fact() {
        let mut schema = ProductSchema::new();
        schema.insert(
            "worktracker_issue".to_owned(),
            TableFacts {
                columns: vec![("rank".to_owned(), "TEXT".to_owned(), true, None, 0, 0)],
                ..TableFacts::default()
            },
        );
        let before = fingerprint(&schema);
        schema
            .get_mut("worktracker_issue")
            .expect("the fixture table")
            .columns[0]
            .1 = "BLOB".to_owned();
        assert_ne!(before, fingerprint(&schema));
    }
}
