//! Durable domain facts for WorkItem and workflow-state writes.
//!
//! Every authored write that changes what Studio displays appends one
//! immutable row to the same ordered outbox the Runs capability already uses,
//! inside the write's own transaction. A rolled-back command therefore
//! publishes nothing, and a committed one is replayable at its cursor.
//!
//! The facts are *domain* facts, not cache instructions: they carry the
//! subject's identity, the revision and timestamp that identify the version,
//! and — where a write can move an item between collections — an explicit
//! membership signal. What a consumer refetches because of a fact is the
//! consumer's decision.

use sea_orm::DatabaseTransaction;
use serde_json::json;

use super::CommandError;
use crate::runs_persistence::{NewStatusEvent, StatusEventRepository};

/// The payload schema these facts are written at. A consumer that does not
/// understand a higher version skips the row rather than guessing at it.
pub const PAYLOAD_VERSION: i32 = 1;

pub const WORK_ITEM_CHANGED: &str = "work_item.changed";
pub const WORK_ITEM_DELETED: &str = "work_item.deleted";
pub const WORKFLOW_STATE_CHANGED: &str = "workflow_state.changed";
pub const WORKFLOW_STATE_DELETED: &str = "workflow_state.deleted";

/// The seam an authored command writes its facts through.
///
/// It is deliberately append-only: a command can publish what it committed and
/// nothing else. Commands accept it as an option so an isolated fixture or a
/// composition without the Runs outbox still runs every invariant, simply
/// without publishing.
#[derive(Clone)]
pub struct WorkFactRecorder(StatusEventRepository);

impl WorkFactRecorder {
    pub fn new(events: StatusEventRepository) -> Self {
        Self(events)
    }

    /// Wake live subscribers. Callers invoke this only after their transaction
    /// commits, so an unavailable subscriber delays delivery rather than
    /// rolling back committed truth.
    pub fn wake(&self) {
        self.0.wake_committed();
    }

    async fn append(
        &self,
        transaction: &DatabaseTransaction,
        event: NewStatusEvent<'_>,
    ) -> Result<(), CommandError> {
        self.0
            .append(transaction, event)
            .await
            .map(|_| ())
            .map_err(|error| CommandError::Storage(error.to_string()))
    }
}

/// What kind of change produced a WorkItem fact. The vocabulary is part of the
/// published contract, so the strings stay stable rather than being formatted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkItemChange {
    Created,
    Updated,
    Transitioned,
    Reparented,
    Reordered,
    Archived,
    Deleted,
}

impl WorkItemChange {
    fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Transitioned => "transitioned",
            Self::Reparented => "reparented",
            Self::Reordered => "reordered",
            Self::Archived => "archived",
            Self::Deleted => "deleted",
        }
    }

    /// Whether this change can move the item into or out of a collection a
    /// consumer is displaying. Ordinary field edits cannot, so they never force
    /// a containing-collection refetch.
    fn membership_changed(self) -> bool {
        !matches!(self, Self::Updated)
    }

    fn event_kind(self) -> &'static str {
        match self {
            Self::Deleted => WORK_ITEM_DELETED,
            _ => WORK_ITEM_CHANGED,
        }
    }
}

/// The identity one WorkItem fact needs, captured before the row is consumed
/// by its own update. Commands read it from the row they just validated, so a
/// fact always describes the version that actually committed.
pub struct WorkItemIdentity {
    pub project_id: String,
    pub work_item_id: String,
    pub parent_id: Option<String>,
    pub module_id: Option<String>,
    pub state_id: Option<String>,
    pub is_archived: bool,
}

impl WorkItemIdentity {
    pub fn of(row: &crate::work_management::entities::issue::Model) -> Self {
        Self {
            project_id: row.project_id.clone(),
            work_item_id: row.id.clone(),
            parent_id: row.parent_id.clone(),
            module_id: row.module_id.clone(),
            state_id: row.state_id.clone(),
            is_archived: row.is_archived,
        }
    }

    pub fn fact<'a>(
        &'a self,
        change: WorkItemChange,
        revision: i64,
        occurred_at: &'a str,
    ) -> WorkItemFact<'a> {
        WorkItemFact {
            project_id: &self.project_id,
            work_item_id: &self.work_item_id,
            change,
            revision,
            occurred_at,
            parent_id: self.parent_id.as_deref(),
            module_id: self.module_id.as_deref(),
            state_id: self.state_id.as_deref(),
            is_archived: self.is_archived,
        }
    }
}

pub struct WorkItemFact<'a> {
    pub project_id: &'a str,
    pub work_item_id: &'a str,
    pub change: WorkItemChange,
    /// The project state revision this write allocated. It is the version
    /// identity a consumer retains and compares.
    pub revision: i64,
    pub occurred_at: &'a str,
    pub parent_id: Option<&'a str>,
    pub module_id: Option<&'a str>,
    pub state_id: Option<&'a str>,
    pub is_archived: bool,
}

/// Append one WorkItem fact inside the caller's transaction.
pub async fn record_work_item(
    recorder: Option<&WorkFactRecorder>,
    transaction: &DatabaseTransaction,
    fact: WorkItemFact<'_>,
) -> Result<(), CommandError> {
    let Some(recorder) = recorder else {
        return Ok(());
    };
    let payload = json!({
        "workItemId": fact.work_item_id,
        "projectId": fact.project_id,
        "changeKind": fact.change.as_str(),
        "membershipChanged": fact.change.membership_changed(),
        "revision": fact.revision,
        "occurredAt": fact.occurred_at,
        "parentId": fact.parent_id,
        "moduleId": fact.module_id,
        "stateId": fact.state_id,
        "isArchived": fact.is_archived,
    });
    recorder
        .append(
            transaction,
            NewStatusEvent {
                event_id: &new_event_id(),
                project_id: fact.project_id,
                event_kind: fact.change.event_kind(),
                payload_version: PAYLOAD_VERSION,
                subject_kind: "work_item",
                subject_id: fact.work_item_id,
                agent_run_id: None,
                automation_attempt_id: None,
                work_item_id: Some(fact.work_item_id),
                payload: &payload,
            },
        )
        .await
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkflowStateChange {
    Created,
    Updated,
    Reordered,
    Deleted,
}

impl WorkflowStateChange {
    fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Reordered => "reordered",
            Self::Deleted => "deleted",
        }
    }

    fn event_kind(self) -> &'static str {
        match self {
            Self::Deleted => WORKFLOW_STATE_DELETED,
            _ => WORKFLOW_STATE_CHANGED,
        }
    }
}

/// The published shape of one workflow state. It carries the whole row a
/// consumer displays, so a rename, recolor, regroup, or reorder converges
/// without a second read.
pub struct WorkflowStateFact<'a> {
    pub project_id: &'a str,
    pub state_id: &'a str,
    pub change: WorkflowStateChange,
    pub name: &'a str,
    pub group: &'a str,
    pub color: &'a str,
    pub sort_order: i32,
    pub occurred_at: &'a str,
}

pub async fn record_workflow_state(
    recorder: Option<&WorkFactRecorder>,
    transaction: &DatabaseTransaction,
    fact: WorkflowStateFact<'_>,
) -> Result<(), CommandError> {
    let Some(recorder) = recorder else {
        return Ok(());
    };
    let payload = json!({
        "stateId": fact.state_id,
        "projectId": fact.project_id,
        "changeKind": fact.change.as_str(),
        "occurredAt": fact.occurred_at,
        "state": {
            "id": fact.state_id,
            "project_id": fact.project_id,
            "name": fact.name,
            "group": fact.group,
            "color": fact.color,
            "sort_order": fact.sort_order,
        },
    });
    recorder
        .append(
            transaction,
            NewStatusEvent {
                event_id: &new_event_id(),
                project_id: fact.project_id,
                event_kind: fact.change.event_kind(),
                payload_version: PAYLOAD_VERSION,
                subject_kind: "workflow_state",
                subject_id: fact.state_id,
                agent_run_id: None,
                automation_attempt_id: None,
                work_item_id: None,
                payload: &payload,
            },
        )
        .await
}

/// Publish a stored timestamp in the same UTC ISO-8601 shape the rest of the
/// status surface uses, so one consumer parses every fact the same way.
pub fn stamp(value: sea_orm::prelude::DateTime) -> String {
    value
        .and_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, false)
}

fn new_event_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_field_edit_does_not_claim_a_membership_change() {
        assert!(!WorkItemChange::Updated.membership_changed());
    }

    #[test]
    fn every_move_creation_and_removal_claims_a_membership_change() {
        for change in [
            WorkItemChange::Created,
            WorkItemChange::Transitioned,
            WorkItemChange::Reparented,
            WorkItemChange::Reordered,
            WorkItemChange::Archived,
            WorkItemChange::Deleted,
        ] {
            assert!(change.membership_changed(), "{change:?}");
        }
    }

    #[test]
    fn removal_is_its_own_event_family() {
        assert_eq!(WorkItemChange::Deleted.event_kind(), WORK_ITEM_DELETED);
        assert_eq!(WorkItemChange::Archived.event_kind(), WORK_ITEM_CHANGED);
        assert_eq!(
            WorkflowStateChange::Deleted.event_kind(),
            WORKFLOW_STATE_DELETED
        );
    }
}
