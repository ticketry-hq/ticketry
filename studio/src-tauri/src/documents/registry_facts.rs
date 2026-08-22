//! Durable, project-scoped facts for committed registry changes.
//!
//! Discovery is the only writer of the Design Document registry, so it is also
//! the only publisher of document facts. Every committed create, change, and
//! delete appends one immutable row to the same ordered outbox the Runs
//! capability already uses, inside the settlement's own transaction: a
//! rolled-back settlement publishes nothing, and a committed one is replayable
//! at its cursor.
//!
//! The project is *resolved*, never submitted. A watcher observes a file, and a
//! file cannot say which project it belongs to; the owning Work Item — or, for
//! a scratch bucket, the owning module — does. A row whose owner cannot be
//! resolved publishes no fact rather than a fact aimed at a guessed project,
//! because a consumer subscribed to the wrong project would either miss the
//! refresh or refresh a workspace the change does not belong to.
//!
//! The facts are domain facts rather than cache instructions. They name the
//! bucket that changed and the document that changed inside it; which holding a
//! consumer refetches because of that remains the consumer's decision.

use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter};
use serde_json::json;

use crate::entities::documents::design_document;
use crate::entities::work_management::issue;
use crate::runs_persistence::{NewStatusEvent, StatusEventRepository};

use super::error::DocumentsError;
use super::identity::{canonical_uuid, compact_uuid, identity_spellings};
use super::registry_refresh::SCRATCH_TASK_ID;

/// The payload schema document facts are written at. A consumer that cannot
/// read a higher version skips the row rather than guessing at it.
pub const PAYLOAD_VERSION: i32 = 1;

pub const DOCUMENT_CHANGED: &str = "document.changed";
pub const DOCUMENT_DELETED: &str = "document.deleted";

/// What kind of registry settlement produced a fact. The vocabulary is part of
/// the published contract, so the strings stay stable rather than formatted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DocumentChange {
    Created,
    Changed,
    Deleted,
}

impl DocumentChange {
    fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Changed => "changed",
            Self::Deleted => "deleted",
        }
    }

    fn event_kind(self) -> &'static str {
        match self {
            Self::Deleted => DOCUMENT_DELETED,
            _ => DOCUMENT_CHANGED,
        }
    }
}

/// The seam a settlement publishes through.
///
/// It is append-only by construction: a settlement can publish what it
/// committed and nothing else. Discovery accepts it as an option so a fixture
/// or a composition without the adopted outbox still reconciles the registry,
/// simply without publishing.
#[derive(Clone)]
pub struct DocumentFactRecorder(StatusEventRepository);

impl DocumentFactRecorder {
    pub fn new(events: StatusEventRepository) -> Self {
        Self(events)
    }

    /// Wake live subscribers. Called only after the settlement transaction
    /// commits, so an unavailable subscriber delays delivery rather than
    /// rolling back committed truth.
    pub fn wake(&self) {
        self.0.wake_committed();
    }
}

/// Which registry a document belongs to, and the identity a consumer keys that
/// registry by.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RegistryOwner {
    /// `task` or `scratch` — the two registries Studio holds separately.
    pub(super) scope: &'static str,
    /// The Work Item a task registry is keyed by, or the module a scratch
    /// registry is keyed by. Always the hyphenated public spelling.
    pub(super) owner_id: String,
    pub(super) module_id: String,
    /// The compact project identity the outbox partitions by.
    pub(super) project_id: String,
}

pub(super) const TASK_REGISTRY: &str = "task";
pub(super) const SCRATCH_REGISTRY: &str = "scratch";

/// Resolve the registry one row belongs to from authoritative ownership.
///
/// A scratch row is owned by its module; a task row by its Work Item. Both are
/// read from the Work Item graph rather than from the row's own copy, so a fact
/// can never claim a project the owner does not actually sit in.
pub(super) async fn resolve_owner(
    database: &impl sea_orm::ConnectionTrait,
    row: &design_document::Model,
) -> Result<Option<RegistryOwner>, DocumentsError> {
    let scratch = compact_uuid(&row.task_id) == compact_uuid(SCRATCH_TASK_ID);
    let owner_identity = if scratch {
        &row.module_id
    } else {
        &row.task_id
    };
    let owner = issue::Entity::find()
        .filter(issue::Column::Id.is_in(identity_spellings(owner_identity)))
        .one(database)
        .await?;
    Ok(owner.map(|owner| RegistryOwner {
        scope: if scratch {
            SCRATCH_REGISTRY
        } else {
            TASK_REGISTRY
        },
        owner_id: canonical_uuid(&owner.id),
        module_id: canonical_uuid(if scratch {
            &owner.id
        } else {
            owner.module_id.as_deref().unwrap_or(&row.module_id)
        }),
        project_id: compact_uuid(&owner.project_id),
    }))
}

/// Append one document fact inside the caller's settlement transaction.
pub(super) async fn record_document(
    recorder: Option<&DocumentFactRecorder>,
    transaction: &DatabaseTransaction,
    owner: &RegistryOwner,
    row: &design_document::Model,
    change: DocumentChange,
) -> Result<(), DocumentsError> {
    let Some(recorder) = recorder else {
        return Ok(());
    };
    // No absolute root, no provenance, no file body: a fact names the identity
    // and the path inside the registry, which is all a refetch needs.
    let payload = json!({
        "documentId": row.id,
        "scope": owner.scope,
        "ownerId": owner.owner_id,
        "moduleId": owner.module_id,
        "relPath": row.rel_path,
        "changeKind": change.as_str(),
        "contentDigest": row.content_digest,
        "occurredAt": row.updated_at,
    });
    recorder
        .0
        .append(
            transaction,
            NewStatusEvent {
                event_id: &uuid::Uuid::new_v4().simple().to_string(),
                project_id: &owner.project_id,
                event_kind: change.event_kind(),
                payload_version: PAYLOAD_VERSION,
                subject_kind: "design_document",
                subject_id: &row.id,
                agent_run_id: None,
                automation_attempt_id: None,
                work_item_id: (owner.scope == TASK_REGISTRY).then(|| owner.owner_id.as_str()),
                payload: &payload,
            },
        )
        .await
        .map(|_| ())
        .map_err(|error| DocumentsError::publication(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_deletion_is_the_only_change_published_as_a_removal() {
        assert_eq!(DocumentChange::Deleted.event_kind(), DOCUMENT_DELETED);
        assert_eq!(DocumentChange::Created.event_kind(), DOCUMENT_CHANGED);
        assert_eq!(DocumentChange::Changed.event_kind(), DOCUMENT_CHANGED);
    }
}
