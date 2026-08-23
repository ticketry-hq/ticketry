//! The first authoritative fact of the Rust era, published exactly once.
//!
//! Studio converges by installing an authoritative snapshot and then following
//! the durable event stream from that snapshot's cursor. After adoption the
//! stream is full of history: every state change, launch, and completion the
//! Python era recorded. Republishing any of it would tell every connected
//! client that old work just happened — which is how a migration turns a
//! finished agent run into a new one, or an archived transition into a fresh
//! notification.
//!
//! So adoption publishes one row per project stating the boundary itself, and
//! nothing else. It replays nothing, re-derives nothing, and starts nothing.
//! The row is a marker whose cursor a client can converge from, and its
//! payload says only what the boundary is: the release that adopted the
//! installation, and how much history preceded it.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde_json::json;

use super::error::{AdoptionFailure, Refusal};
use super::outcome::EventBoundary;
use super::phase::Phase;

/// The event kind a boundary row carries. Studio treats it as a marker.
pub const BOUNDARY_EVENT_KIND: &str = "installation.adopted";

/// The subject kind. The subject of a boundary is the installation itself.
pub const BOUNDARY_SUBJECT_KIND: &str = "installation";

/// Publish one boundary event per project, after postflight and before writes.
///
/// Idempotent by construction: a project that already carries a boundary for
/// this adoption is skipped, so a restart that reruns validation cannot stack
/// a second marker on a stream that already converged past the first.
pub async fn publish(
    database: &DatabaseConnection,
    application_version: &str,
    adoption_id: &str,
) -> Result<Option<EventBoundary>, AdoptionFailure> {
    if !table_exists(database, "runs_status_events").await? {
        // A generation with no durable event ledger has no stream to converge,
        // so there is no boundary to publish and nothing is invented.
        return Ok(None);
    }
    let prior = count(database, "SELECT COUNT(*) AS total FROM runs_status_events").await?;
    let projects = project_identities(database).await?;
    let mut published = Vec::new();
    for project in &projects {
        if boundary_exists(database, project, adoption_id).await? {
            continue;
        }
        let payload = json!({
            "adoptionId": adoption_id,
            "applicationVersion": application_version,
            "priorEvents": prior,
        });
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO runs_status_events (
                    event_id, project_id, event_kind, payload_version,
                    subject_kind, subject_id, payload
                 ) VALUES (?, ?, ?, 1, ?, ?, ?)",
                [
                    uuid::Uuid::new_v4().simple().to_string().into(),
                    project.clone().into(),
                    BOUNDARY_EVENT_KIND.into(),
                    BOUNDARY_SUBJECT_KIND.into(),
                    adoption_id.into(),
                    payload.to_string().into(),
                ],
            ))
            .await
            .map_err(failed)?;
        published.push(project.clone());
    }
    if projects.is_empty() {
        return Ok(None);
    }
    let cursor = count(
        database,
        "SELECT COALESCE(MAX(cursor), 0) AS total FROM runs_status_events",
    )
    .await?;
    Ok(Some(EventBoundary {
        projects: published,
        cursor,
        prior_events: prior.max(0).unsigned_abs(),
    }))
}

async fn project_identities(database: &DatabaseConnection) -> Result<Vec<String>, AdoptionFailure> {
    if !table_exists(database, "worktracker_project").await? {
        return Ok(Vec::new());
    }
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id FROM worktracker_project ORDER BY id".to_owned(),
        ))
        .await
        .map_err(failed)?;
    rows.into_iter()
        .map(|row| row.try_get::<String>("", "id").map_err(failed))
        .collect()
}

async fn boundary_exists(
    database: &DatabaseConnection,
    project: &str,
    adoption_id: &str,
) -> Result<bool, AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS total FROM runs_status_events \
             WHERE project_id = ? AND event_kind = ? AND subject_id = ?",
            [
                project.into(),
                BOUNDARY_EVENT_KIND.into(),
                adoption_id.into(),
            ],
        ))
        .await
        .map_err(failed)?
        .ok_or_else(|| failure("the event ledger returned no row".to_owned()))?;
    Ok(row.try_get::<i64>("", "total").map_err(failed)? > 0)
}

async fn count(database: &DatabaseConnection, query: &str) -> Result<i64, AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .map_err(failed)?
        .ok_or_else(|| failure(format!("{query} returned no row")))?;
    row.try_get::<i64>("", "total").map_err(failed)
}

async fn table_exists(database: &DatabaseConnection, table: &str) -> Result<bool, AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?",
            [table.into()],
        ))
        .await
        .map_err(failed)?
        .ok_or_else(|| failure("schema inspection returned no row".to_owned()))?;
    Ok(row.try_get::<i64>("", "total").map_err(failed)? == 1)
}

fn failed(error: impl std::fmt::Display) -> AdoptionFailure {
    failure(error.to_string())
}

fn failure(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(Phase::EventBoundary, Refusal::EventBoundaryFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{BOUNDARY_EVENT_KIND, BOUNDARY_SUBJECT_KIND};

    #[test]
    fn the_boundary_is_its_own_event_kind() {
        // A boundary must not be mistakable for a run lifecycle fact, or a
        // client would treat the migration as an agent that just did something.
        assert_ne!(BOUNDARY_EVENT_KIND, "agent_run.lifecycle");
        assert_ne!(BOUNDARY_EVENT_KIND, "agent_run.terminal");
        assert_ne!(BOUNDARY_SUBJECT_KIND, "agent_run");
    }
}
