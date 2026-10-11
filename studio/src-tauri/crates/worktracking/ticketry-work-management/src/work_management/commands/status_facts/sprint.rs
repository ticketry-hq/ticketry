//! Durable sequence changes for Sprint list subscribers.

use sea_orm::DatabaseTransaction;
use serde_json::json;
use ticketry_runs::NewStatusEvent;

use super::{new_event_id, WorkFactRecorder, PAYLOAD_VERSION};
use crate::work_management::commands::CommandError;

pub(crate) async fn record_sprint_reorder(
    recorder: Option<&WorkFactRecorder>,
    transaction: &DatabaseTransaction,
    sprint: &ticketry_entities::sprint::Model,
    revision: i64,
    occurred_at: &str,
) -> Result<(), CommandError> {
    let Some(recorder) = recorder else {
        return Ok(());
    };
    let payload = json!({
        "projectId": sprint.project_id,
        "sprintId": sprint.id,
        "changeKind": "reordered",
        "revision": revision,
        "rank": sprint.rank,
        "occurredAt": occurred_at,
    });
    recorder
        .append(
            transaction,
            NewStatusEvent {
                event_id: &new_event_id(),
                project_id: &sprint.project_id,
                event_kind: "sprint.changed",
                payload_version: PAYLOAD_VERSION,
                subject_kind: "sprint",
                subject_id: &sprint.id,
                agent_run_id: None,
                automation_attempt_id: None,
                work_item_id: None,
                payload: &payload,
            },
        )
        .await
}
