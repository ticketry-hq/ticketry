use std::collections::{BTreeMap, BTreeSet};

use sea_orm::{ConnectionTrait, DbBackend, Statement};
use sha2::{Digest, Sha256};

use super::adoption::TableEvidence;
use super::inspection::table_exists;
use super::schema;
use super::{ExecutionPersistenceError, ExecutionPersistenceErrorCode};

pub(super) async fn evidence_columns(
    database: &impl ConnectionTrait,
) -> Result<BTreeMap<String, BTreeSet<String>>, ExecutionPersistenceError> {
    let mut result = BTreeMap::new();
    for table in ["graph_runs", "launched_tasks", "launch_policy_effects"] {
        if table_exists(database, table).await? {
            result.insert(table.to_owned(), schema::columns(database, table).await?);
        }
    }
    Ok(result)
}

pub(super) async fn table_evidence(
    database: &impl ConnectionTrait,
    projection: Option<&BTreeMap<String, BTreeSet<String>>>,
) -> Result<BTreeMap<String, TableEvidence>, ExecutionPersistenceError> {
    let mut evidence = BTreeMap::new();
    for table in ["graph_runs", "launched_tasks", "launch_policy_effects"] {
        if !table_exists(database, table).await?
            || projection.is_some_and(|tables| !tables.contains_key(table))
        {
            continue;
        }
        let columns = match projection.and_then(|tables| tables.get(table)) {
            Some(columns) => columns.clone(),
            None => schema::columns(database, table).await?,
        };
        let expression = columns
            .iter()
            .map(|column| format!("\"{column}\""))
            .collect::<Vec<_>>()
            .join(",");
        let primary = if table == "graph_runs" {
            "root_id"
        } else if table == "launched_tasks" {
            "task_id"
        } else {
            "decision_id"
        };
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!(
                    "SELECT json_array({expression}) AS row_data FROM {table} ORDER BY {primary}"
                ),
            ))
            .await
            .map_err(storage)?;
        let mut hasher = Sha256::new();
        for row in &rows {
            hasher.update(
                row.try_get::<String>("", "row_data")
                    .map_err(storage)?
                    .as_bytes(),
            );
            hasher.update(b"\n");
        }
        evidence.insert(
            table.to_owned(),
            TableEvidence {
                row_count: rows.len() as i64,
                stable_digest: format!("{:x}", hasher.finalize()),
            },
        );
    }
    Ok(evidence)
}

pub(super) fn combined_digest(tables: &BTreeMap<String, TableEvidence>) -> String {
    let mut hasher = Sha256::new();
    for (table, evidence) in tables {
        hasher.update(table.as_bytes());
        hasher.update(evidence.stable_digest.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn storage(source: sea_orm::DbErr) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(
        ExecutionPersistenceErrorCode::AdoptionUnavailable,
        format!("Execution adoption storage operation failed: {source}"),
    )
}
