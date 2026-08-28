//! Build the private SQLite target and prove its logical parity.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
    TransactionTrait, Value,
};

use super::canonical::{Cell, Kind};
use super::failed;
use super::inventory::Inventory;
use super::schema_catalog;
use super::source::{Column, Snapshot};
use crate::installation::adoption::{AdoptionFailure, Phase, Refusal};

struct DeferredTable {
    name: String,
    columns: Vec<Column>,
    rows: Vec<Vec<Cell>>,
}

pub async fn copy_snapshot(
    directory: &Path,
    source: &Snapshot,
    source_generation: &str,
) -> Result<(Inventory, Vec<String>), AdoptionFailure> {
    let database = open(&directory.join("state.db")).await?;
    let outcome = copy(&database, source, source_generation).await;
    let closed = database.close().await;
    let (inventory, bridges) = outcome?;
    closed.map_err(|error| {
        target_error(format!("the staged SQLite database stayed open: {error}"))
    })?;
    validate(directory, &inventory).await?;
    Ok((inventory, bridges))
}

async fn copy(
    database: &DatabaseConnection,
    source: &Snapshot,
    source_generation: &str,
) -> Result<(Inventory, Vec<String>), AdoptionFailure> {
    let selected_schema = schema_catalog::select(source_generation).map_err(target_error)?;
    for statement in &selected_schema.statements {
        database
            .execute_unprepared(statement)
            .await
            .map_err(|error| {
                target_error(format!(
                    "the checked {source_generation} staging schema could not be applied: {error}"
                ))
            })?;
    }
    let target = target_columns(database).await?;
    let source_tables = source.tables().await?;
    let source_table_set = source_tables.iter().cloned().collect::<BTreeSet<_>>();
    let target_table_set = target.keys().cloned().collect::<BTreeSet<_>>();
    let source_product = source_table_set
        .iter()
        .filter(|table| crate::installation::classification::schema_facts::is_product_table(table))
        .cloned()
        .collect::<BTreeSet<_>>();
    let target_product = target_table_set
        .iter()
        .filter(|table| crate::installation::classification::schema_facts::is_product_table(table))
        .cloned()
        .collect::<BTreeSet<_>>();
    if source_product != target_product {
        let missing = target_product
            .difference(&source_product)
            .cloned()
            .collect::<Vec<_>>();
        let unknown = source_product
            .difference(&target_product)
            .cloned()
            .collect::<Vec<_>>();
        return Err(target_error(format!(
            "the PostgreSQL schema does not match {source_generation}: missing [{}], unknown [{}]",
            missing.join(", "),
            unknown.join(", ")
        )));
    }
    let transaction = database
        .begin()
        .await
        .map_err(|error| target_error(error.to_string()))?;
    transaction
        .execute_unprepared("PRAGMA defer_foreign_keys = ON")
        .await
        .map_err(|error| target_error(error.to_string()))?;

    let mut imported = Inventory::default();
    let mut deferred = Vec::new();
    for table in source_tables {
        let source_columns = source.columns(&table).await?;
        if source_columns.is_empty() {
            continue;
        }
        let source_rows = source.rows(&table, &source_columns).await?;
        let Some(target_names) = target.get(&table) else {
            deferred.push(DeferredTable {
                name: table,
                columns: source_columns,
                rows: source_rows,
            });
            continue;
        };
        let source_names = source_columns
            .iter()
            .map(|column| column.name.clone())
            .collect::<BTreeSet<_>>();
        let missing = source_columns
            .iter()
            .filter(|column| !target_names.contains(&column.name))
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();
        let extra = target_names
            .difference(&source_names)
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() || !extra.is_empty() {
            return Err(target_error(format!(
                "{table} does not match {source_generation}: unknown source columns [{}], missing source columns [{}]",
                missing.join(", "),
                extra.join(", ")
            )));
        }
        let retained = source_columns
            .iter()
            .enumerate()
            .filter(|(_, column)| target_names.contains(&column.name))
            .map(|(index, column)| (index, column.clone()))
            .collect::<Vec<_>>();
        let source_columns = retained
            .iter()
            .map(|(_, column)| column.clone())
            .collect::<Vec<_>>();
        let rows = source_rows
            .into_iter()
            .map(|row| {
                retained
                    .iter()
                    .map(|(index, _)| row[*index].clone())
                    .collect()
            })
            .collect::<Vec<_>>();
        insert_rows(&transaction, &table, &source_columns, &rows).await?;
        imported.record(&table, &rows);
    }
    transaction
        .commit()
        .await
        .map_err(|error| target_error(format!("the staged copy did not commit: {error}")))?;

    let target_inventory = read_target(database, source, &imported).await?;
    let differences = imported.differences(&target_inventory);
    if !differences.is_empty() {
        return Err(target_error(format!(
            "the staged SQLite target differs from PostgreSQL: {}",
            differences.join("; ")
        )));
    }
    let bridges =
        bridge_to_current(database, source_generation, selected_schema.fingerprint).await?;
    let deferred_inventory = restore_framework(database, &deferred).await?;
    imported.counts.extend(deferred_inventory.counts);
    imported.digests.extend(deferred_inventory.digests);
    promote_migration_ledger(database, source_generation).await?;
    Ok((imported, bridges))
}

async fn restore_framework(
    database: &DatabaseConnection,
    deferred: &[DeferredTable],
) -> Result<Inventory, AdoptionFailure> {
    let target = target_columns(database).await?;
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .map_err(|error| target_error(error.to_string()))?;
    let transaction = database
        .begin()
        .await
        .map_err(|error| target_error(error.to_string()))?;
    let outcome = async {
        let mut source_inventory = Inventory::default();
        for table in deferred {
            let target_names = target.get(&table.name).ok_or_else(|| {
                target_error(format!(
                    "canonical SQLite has no framework table {} required by PostgreSQL",
                    table.name
                ))
            })?;
            let source_names = table
                .columns
                .iter()
                .map(|column| column.name.clone())
                .collect::<BTreeSet<_>>();
            if &source_names != target_names {
                return Err(target_error(format!(
                    "framework table {} has different columns across engines",
                    table.name
                )));
            }
            transaction
                .execute_unprepared(&format!("DELETE FROM {}", quoted(&table.name)))
                .await
                .map_err(|error| target_error(error.to_string()))?;
            insert_rows(&transaction, &table.name, &table.columns, &table.rows).await?;
            source_inventory.record(&table.name, &table.rows);
        }
        transaction.commit().await.map_err(|error| {
            target_error(format!(
                "the deferred framework copy did not commit: {error}"
            ))
        })?;
        Ok::<_, AdoptionFailure>(source_inventory)
    }
    .await;
    database
        .execute_unprepared("PRAGMA foreign_keys = ON")
        .await
        .map_err(|error| target_error(error.to_string()))?;
    let source_inventory = outcome?;

    let mut target_inventory = Inventory::default();
    for table in deferred {
        let rows = read_sqlite_rows(database, &table.name, &table.columns).await?;
        target_inventory.record(&table.name, &rows);
    }
    let differences = source_inventory.differences(&target_inventory);
    if !differences.is_empty() {
        return Err(target_error(format!(
            "deferred framework rows differ after import: {}",
            differences.join("; ")
        )));
    }
    Ok(source_inventory)
}

async fn bridge_to_current(
    database: &DatabaseConnection,
    source_generation: &str,
    source_fingerprint: &str,
) -> Result<Vec<String>, AdoptionFailure> {
    if source_generation == crate::installation::classification::manifest().current_generation {
        return Ok(Vec::new());
    }
    let bridge =
        crate::installation::adoption::bridge::select(source_generation, source_fingerprint)?;
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .map_err(|error| {
            target_error(format!(
                "foreign keys could not be suspended for import: {error}"
            ))
        })?;
    let transaction = database
        .begin()
        .await
        .map_err(|error| target_error(error.to_string()))?;
    let outcome = crate::installation::adoption::bridge::apply(&transaction, &[bridge]).await;
    match outcome {
        Ok(()) => transaction
            .commit()
            .await
            .map_err(|error| target_error(error.to_string()))?,
        Err(error) => {
            let _ = transaction.rollback().await;
            let _ = database
                .execute_unprepared("PRAGMA foreign_keys = ON")
                .await;
            return Err(error);
        }
    }
    database
        .execute_unprepared("PRAGMA foreign_keys = ON")
        .await
        .map_err(|error| {
            target_error(format!(
                "foreign keys could not be restored after import: {error}"
            ))
        })?;
    Ok(vec![format!(
        "postgres-{}",
        bridge.id.strip_prefix("sqlite-").unwrap_or(&bridge.id)
    )])
}

/// The canonical target carries the full retained migration provenance.
///
/// This changes only the staged SQLite database. It neither executes Django
/// migration code nor writes the PostgreSQL source. Tables already present in
/// the canonical schema receive no synthetic product rows.
async fn promote_migration_ledger(
    database: &DatabaseConnection,
    source_generation: &str,
) -> Result<(), AdoptionFailure> {
    let manifest = crate::installation::classification::manifest();
    if source_generation == manifest.current_generation {
        return Ok(());
    }
    let source = manifest.generation(source_generation).ok_or_else(|| {
        target_error(format!(
            "the source generation {source_generation} disappeared from the checked manifest"
        ))
    })?;
    let source_applied = source.applied.iter().collect::<BTreeSet<_>>();
    let now = crate::installation::adoption::now_rfc3339();
    let transaction = database
        .begin()
        .await
        .map_err(|error| target_error(error.to_string()))?;
    for migration in &manifest.current().applied {
        if source_applied.contains(migration) {
            continue;
        }
        let (app, name) = migration.split_once('.').ok_or_else(|| {
            target_error(format!(
                "the checked migration name {migration} is malformed"
            ))
        })?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO django_migrations (app, name, applied) VALUES (?, ?, ?)",
                [app.into(), name.into(), now.clone().into()],
            ))
            .await
            .map_err(|error| {
                target_error(format!(
                    "canonical migration provenance {migration} could not be recorded: {error}"
                ))
            })?;
    }
    transaction.commit().await.map_err(|error| {
        target_error(format!(
            "canonical migration provenance did not commit: {error}"
        ))
    })?;
    Ok(())
}

async fn insert_rows<C: ConnectionTrait>(
    database: &C,
    table: &str,
    columns: &[Column],
    rows: &[Vec<Cell>],
) -> Result<(), AdoptionFailure> {
    let names = columns
        .iter()
        .map(|column| quoted(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = std::iter::repeat("?")
        .take(columns.len())
        .collect::<Vec<_>>()
        .join(", ");
    let statement = format!(
        "INSERT INTO {} ({names}) VALUES ({placeholders})",
        quoted(table)
    );
    for (row_index, row) in rows.iter().enumerate() {
        let values = row.iter().map(value).collect::<Vec<_>>();
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                statement.clone(),
                values,
            ))
            .await
            .map_err(|error| {
                target_error(format!(
                    "row {} from {table} could not be staged: {error}",
                    row_index + 1,
                ))
            })?;
    }
    Ok(())
}

async fn read_target(
    database: &DatabaseConnection,
    source: &Snapshot,
    expected: &Inventory,
) -> Result<Inventory, AdoptionFailure> {
    let mut inventory = Inventory::default();
    for table in expected.counts.keys() {
        if expected.counts.get(table) == Some(&0) {
            inventory.record(table, &[]);
            continue;
        }
        let columns = source.columns(table).await?;
        let rows = read_sqlite_rows(database, table, &columns).await?;
        inventory.record(table, &rows);
    }
    Ok(inventory)
}

async fn read_sqlite_rows(
    database: &DatabaseConnection,
    table: &str,
    columns: &[Column],
) -> Result<Vec<Vec<Cell>>, AdoptionFailure> {
    let select = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let name = quoted(&column.name);
            let expression = if column.kind == Kind::Binary {
                format!("lower(hex({name}))")
            } else {
                format!("CAST({name} AS TEXT)")
            };
            format!("{expression} AS c{index}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT {select} FROM {}", quoted(table)),
        ))
        .await
        .map_err(|error| target_error(format!("staged {table} rows could not be read: {error}")))?;
    rows.into_iter()
        .map(|row| {
            columns
                .iter()
                .enumerate()
                .map(|(index, column)| {
                    let value = row
                        .try_get::<Option<String>>("", &format!("c{index}"))
                        .map_err(|error| {
                            target_error(format!(
                                "staged {table}.{} could not be read: {error}",
                                column.name
                            ))
                        })?;
                    Cell::from_sqlite(column.kind, value).map_err(|error| {
                        target_error(format!("staged {table}.{}: {error}", column.name))
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .collect()
}

async fn validate(directory: &Path, imported: &Inventory) -> Result<(), AdoptionFailure> {
    let classified = crate::installation::classification::classify(directory)
        .await
        .map_err(|error| target_error(format!("the staged target does not classify: {error}")))?;
    let report = crate::installation::preflight::preflight(directory, &classified)
        .await
        .map_err(|error| {
            target_error(format!(
                "the staged target could not be preflighted: {error}"
            ))
        })?;
    if report.verdict() == crate::installation::preflight::Verdict::Refused {
        return Err(target_error(format!(
            "the staged target failed {} semantic check(s): {}",
            report.defects.len(),
            report
                .defects
                .iter()
                .map(|defect| defect.code.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let database = open_existing(&directory.join("state.db")).await?;
    crate::installation::adoption::integrity::structural(&database)
        .await
        .map_err(|error| {
            target_error(format!(
                "the staged target failed integrity checks: {error}"
            ))
        })?;
    let present = crate::installation::adoption::inventory::product_tables(&database)
        .await
        .map_err(|error| {
            target_error(format!(
                "the staged target tables could not be listed: {error}"
            ))
        })?;
    let unanswered = crate::installation::adoption::representative_reads::prove(&database, &present)
        .await
        .map_err(|error| target_error(format!("a staged representative read failed: {error}")))?;
    database
        .close()
        .await
        .map_err(|error| target_error(error.to_string()))?;
    if !unanswered.is_empty() {
        return Err(target_error(format!(
            "the staged target failed representative reads: {}",
            unanswered.join("; ")
        )));
    }
    if imported.counts.is_empty() {
        return Err(target_error(
            "the PostgreSQL snapshot contained no recognized tables",
        ));
    }
    Ok(())
}

async fn target_columns(
    database: &DatabaseConnection,
) -> Result<BTreeMap<String, BTreeSet<String>>, AdoptionFailure> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(|error| target_error(error.to_string()))?;
    let mut tables = BTreeMap::new();
    for row in rows {
        let table = row
            .try_get::<String>("", "name")
            .map_err(|error| target_error(error.to_string()))?;
        let columns = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{}')", table.replace('\'', "''")),
            ))
            .await
            .map_err(|error| target_error(error.to_string()))?
            .into_iter()
            .map(|row| {
                row.try_get::<String>("", "name")
                    .map_err(|error| target_error(error.to_string()))
            })
            .collect::<Result<BTreeSet<_>, _>>()?;
        tables.insert(table, columns);
    }
    Ok(tables)
}

async fn open(path: &Path) -> Result<DatabaseConnection, AdoptionFailure> {
    let mut options = ConnectOptions::new("sqlite://postgres-import?mode=rwc");
    let owned = path.to_owned();
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |sqlite| {
            sqlite
                .filename(owned.clone())
                .create_if_missing(true)
                .pragma("foreign_keys", "ON")
        });
    Database::connect(options).await.map_err(|error| {
        target_error(format!(
            "the staged SQLite target could not be created: {error}"
        ))
    })
}

async fn open_existing(path: &Path) -> Result<DatabaseConnection, AdoptionFailure> {
    crate::installation::adoption::exclusive::open_shared(path).await
}

fn value(cell: &Cell) -> Value {
    match cell {
        Cell::Null => Value::String(None),
        Cell::Text(value) => Value::String(Some(value.clone())),
        Cell::Binary(value) => Value::Bytes(Some(value.clone())),
    }
}

fn quoted(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn target_error(detail: impl Into<String>) -> AdoptionFailure {
    failed(Phase::Postflight, Refusal::PostflightFailed, detail)
}
