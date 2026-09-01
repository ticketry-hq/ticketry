//! The one-way Slice 3 Runs handoff, in the order the crash boundaries need.
//!
//! Adoption happens before the write lease changes hands, while the sidecar is
//! still stopped and no Django writer is running. Reconciliation and the
//! readiness publication happen after the sidecar is up, because both need the
//! temporary terminal executor to answer. Outbox compaction runs between the
//! two: it settles the replay watermark while no client can be streaming, and
//! it installs the periodic driver that keeps the outbox bounded for as long
//! as this process lives. Readiness is published only when
//! every one of those steps succeeded; a partial result closes the gate and
//! every Runs surface answers a structured unavailable error instead of
//! reaching for a Django writer that no longer exists.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use sea_orm::DatabaseConnection;
use tauri_graphql::TransportApi;

use ticketry_runs::{self, CompactionSchedule, RunsPersistenceError, Slice3Readiness};

/// Publish the closed gate. Called at startup, at every backend launch, and at
/// shutdown, so a stale `ready: true` record can never outlive its runtime.
pub fn close_gate(data_directory: &Path) -> Result<(), RunsPersistenceError> {
    ticketry_runs::publish_readiness(data_directory, &Slice3Readiness::unavailable())
}

/// Reopen the gate after the supervised pair recovered. Every step is
/// idempotent: the health probe is a read, and a reconciliation pass that has
/// nothing to decide changes nothing.
pub async fn reopen_gate(
    data_directory: &Path,
    database: &DatabaseConnection,
) -> Result<(), String> {
    compact(database).await;
    ticketry_runs::publish_readiness(data_directory, &Slice3Readiness::complete())
        .map_err(|error| format!("could not publish Slice 3 readiness: {error}"))
}

/// Whether this process has already installed the periodic compaction driver.
/// Both gates run the startup pass, but recovery must not leave a second
/// driver behind every time the pair is restarted.
static PERIODIC_COMPACTION_INSTALLED: AtomicBool = AtomicBool::new(false);

/// Retire outbox history the retention policy no longer covers, then keep
/// retiring it for the life of the process.
///
/// This runs after reconciliation and before readiness is published, so the
/// compaction watermark a resuming client reads is settled before any client
/// can be streaming. A failed pass does not hold the gate closed: an outbox
/// that could not be pruned still answers every status subscription correctly,
/// and the periodic driver offers it the next pass.
async fn compact(database: &DatabaseConnection) {
    let schedule = CompactionSchedule::new(database.clone());
    if let Err(error) = schedule.pass().await {
        eprintln!("Ticketry could not compact the Runs status outbox: {error}");
    }
    if !PERIODIC_COMPACTION_INSTALLED.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(schedule.drive());
    }
}

/// Drain the durable launch backlog. A conflicting runtime is surfaced rather
/// than swallowed: it needs a person, and it is never overwritten or retried.
/// Complete the handoff once the sidecar answers: prove the temporary executor
/// gave up its Runs writers, drain the durable launch backlog, prove the status
/// surface is registered, and only then open the gate.
pub async fn open_gate(
    data_directory: &Path,
    database: &DatabaseConnection,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), String> {
    compact(database).await;
    verify_status_surface(api).await?;

    ticketry_runs::publish_readiness(data_directory, &Slice3Readiness::complete())
        .map_err(|error| format!("could not publish Slice 3 readiness: {error}"))
}

/// Prove the authoritative query and the status subscription are both
/// registered on the installed schema before Studio is told status is live.
async fn verify_status_surface(api: &tauri_graphql::TransportApiImpl) -> Result<(), String> {
    let response = api
        .clone()
        .graphql_execute(
            serde_json::json!({
                "query": "query Slice3StatusSurface { __type(name: \"Subscription\") { fields { name } } __schema { queryType { fields { name } } } }"
            })
            .to_string(),
        )
        .await;
    let value: serde_json::Value = serde_json::from_str(&response)
        .map_err(|error| format!("could not decode the Slice 3 status probe: {error}"))?;
    if value.get("errors").is_some() {
        return Err("the Slice 3 status probe returned errors".to_owned());
    }
    let has_field = |pointer: &str, name: &str| {
        value
            .pointer(pointer)
            .and_then(serde_json::Value::as_array)
            .is_some_and(|fields| {
                fields.iter().any(|field| {
                    field.get("name").and_then(serde_json::Value::as_str) == Some(name)
                })
            })
    };
    if !has_field("/data/__type/fields", "run_status_stream") {
        return Err("the Runs status subscription is not registered".to_owned());
    }
    if !has_field("/data/__schema/queryType/fields", "agent_run_holdings") {
        return Err("the authoritative Runs query is not registered".to_owned());
    }
    Ok(())
}
