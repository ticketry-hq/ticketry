use super::*;

pub(super) async fn table_evidence(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<BTreeMap<String, TableEvidence>, TerminalPersistenceError> {
    let mut result = BTreeMap::new();
    for (table, columns) in expected_columns(source) {
        if table == LEDGER_TABLE {
            continue;
        }
        result.insert(
            table.to_owned(),
            TableEvidence {
                row_count: row_count(database, table).await?,
                stable_digest: stable_digest(database, table, columns).await?,
            },
        );
    }
    Ok(result)
}

pub(super) async fn stable_digest(
    database: &impl ConnectionTrait,
    table: &str,
    columns: &[&str],
) -> Result<String, TerminalPersistenceError> {
    let expression = columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(",");
    let order = columns.first().copied().unwrap_or("rowid");
    let query =
        format!("SELECT json_array({expression}) AS row_data FROM {table} ORDER BY \"{order}\"");
    let mut hasher = Sha256::new();
    hasher.update(table.as_bytes());
    hasher.update(b"\n");
    for row in database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .map_err(storage)?
    {
        hasher.update(
            row.try_get::<String>("", "row_data")
                .map_err(storage)?
                .as_bytes(),
        );
        hasher.update(b"\n");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(super) const EMPTY_DIGEST: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

pub(super) async fn row_count(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<u64, TerminalPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .map_err(storage)?
        .unwrap();
    Ok(row.try_get::<i64>("", "count").map_err(storage)? as u64)
}

pub(super) async fn active_lease_count(
    database: &impl ConnectionTrait,
) -> Result<u64, TerminalPersistenceError> {
    if !table_exists(database, "agent_run_viewer_leases").await? {
        return Ok(0);
    }
    let row = database.query_one_raw(Statement::from_string(DbBackend::Sqlite, "SELECT COUNT(*) AS count FROM agent_run_viewer_leases WHERE expires_at > CURRENT_TIMESTAMP".to_owned())).await.map_err(storage)?.unwrap();
    Ok(row.try_get::<i64>("", "count").map_err(storage)? as u64)
}

pub(super) async fn schema_fingerprint(
    database: &impl ConnectionTrait,
) -> Result<String, TerminalPersistenceError> {
    let rows = database.query_all_raw(Statement::from_string(DbBackend::Sqlite, "SELECT type, name, COALESCE(sql,'') AS sql FROM sqlite_master WHERE name IN ('agent_terminal_sessions','agent_run_viewer_leases','terminal_launch_requests','terminal_launch_material','terminal_cleanup_effects','ticketry_terminal_adoption','idx_agent_terminal_sessions_task_created','agent_terminal_sessions_runtime_namespace_a928a9d9','idx_terminal_launch_material_scope','idx_terminal_cleanup_effects_reconcile') ORDER BY type,name".to_owned())).await.map_err(storage)?;
    let mut hasher = Sha256::new();
    for row in rows {
        for column in ["type", "name", "sql"] {
            hasher.update(
                row.try_get::<String>("", column)
                    .map_err(storage)?
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .as_bytes(),
            );
            hasher.update(b"\0");
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(super) async fn verify_snapshot(
    path: &Path,
    source: SourceClassification,
    expected_fingerprint: &str,
    expected: &BTreeMap<String, TableEvidence>,
) -> Result<(), TerminalPersistenceError> {
    let database = connect(path, true).await?;
    integrity(&database).await?;
    if classify(&database).await? != source
        || schema_fingerprint(&database).await? != expected_fingerprint
        || table_evidence(&database, source).await? != *expected
    {
        return Err(invalid("Terminal snapshot changed during verification"));
    }
    database.close().await.map_err(storage)
}

pub(super) async fn integrity(
    database: &impl ConnectionTrait,
) -> Result<(), TerminalPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await
        .map_err(storage)?
        .ok_or_else(|| invalid("SQLite integrity check returned no result"))?;
    if row
        .try_get::<String>("", "integrity_check")
        .map_err(storage)?
        != "ok"
    {
        return Err(invalid("SQLite integrity check failed"));
    }
    Ok(())
}
