//! Durable preparation, before any external effect.
//!
//! Preparation commits first so that a crash between the transaction and the
//! filesystem or Git mutation still leaves a row that says what was intended.
//! Reusing an operation ID is therefore normal: the same fingerprint is a
//! transport retry and returns the durable operation with whatever result it
//! already holds, while a different fingerprint is a typed conflict, because
//! rebinding a durable identity to new intent would make recovery a guess.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, EntityTrait, TransactionTrait,
};

use super::entities::operation as operation_entity;
use super::records::operation;
use super::{
    WorkspaceOperationError, WorkspaceOperationErrorCode, WorkspaceOperationIntent,
    WorkspaceOperationJournal, WorkspaceOperationRecord,
};

/// How many times a preparation that lost the store's write lock is retried
/// before the request is reported unavailable.
const PREPARE_ATTEMPTS: usize = 4;
const PREPARE_BACKOFF_MILLIS: u64 = 10;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedOperation {
    pub operation: WorkspaceOperationRecord,
    /// True when the identity was already durable. A repeated request reuses
    /// its operation instead of minting a second one, and an already-applied
    /// operation replays its result through `operation.result()`.
    pub reused: bool,
}

impl WorkspaceOperationJournal {
    /// Prepare one operation, retrying a write that lost a race with another
    /// writer rather than reporting the race as a failure.
    ///
    /// Two callers preparing *different* operations at the same moment are
    /// ordinary — SQLite serializes their writes, and a transaction that
    /// cannot take the write lock is asked to try again. Only a repeatedly
    /// unavailable store is an error.
    pub async fn prepare(
        &self,
        intent: WorkspaceOperationIntent,
    ) -> Result<PreparedOperation, WorkspaceOperationError> {
        let intent = intent.normalized()?;
        let mut last = None;
        for attempt in 0..PREPARE_ATTEMPTS {
            match self.prepare_once(&intent).await {
                Ok(prepared) => return Ok(prepared),
                Err(error) if error.code() == WorkspaceOperationErrorCode::Storage => {
                    last = Some(error);
                    tokio::time::sleep(std::time::Duration::from_millis(
                        PREPARE_BACKOFF_MILLIS * (attempt + 1) as u64,
                    ))
                    .await;
                }
                Err(error) => return Err(error),
            }
        }
        Err(last.unwrap_or_else(|| {
            WorkspaceOperationError::new(
                WorkspaceOperationErrorCode::Storage,
                "The Workspace Operation could not be prepared.",
            )
        }))
    }

    async fn prepare_once(
        &self,
        intent: &super::intent::NormalizedIntent,
    ) -> Result<PreparedOperation, WorkspaceOperationError> {
        let transaction = self.database().begin().await?;

        if let Some(existing) = operation_entity::Entity::find_by_id(&intent.operation_id)
            .one(&transaction)
            .await?
            .map(operation)
        {
            transaction.commit().await?;
            if existing.intent_fingerprint != intent.fingerprint {
                return Err(WorkspaceOperationError::new(
                    WorkspaceOperationErrorCode::FingerprintConflict,
                    "The Workspace Operation identity is already durable under different intent.",
                ));
            }
            return Ok(PreparedOperation {
                operation: existing,
                reused: true,
            });
        }

        let prepared = operation_entity::ActiveModel {
            operation_id: Set(intent.operation_id.clone()),
            kind: Set(intent.kind.code().to_owned()),
            intent_version: Set(intent.intent_version),
            resource_kind: Set(intent.kind.resource_kind().code().to_owned()),
            resource_key: Set(intent.resource_key.clone()),
            intent: Set(intent.canonical.clone()),
            intent_fingerprint: Set(intent.fingerprint.clone()),
            state: NotSet,
            lease_owner: NotSet,
            lease_expires_at: NotSet,
            attempt_count: NotSet,
            last_error_code: NotSet,
            last_error_message: NotSet,
            evidence: NotSet,
            result_summary: NotSet,
            created_at: NotSet,
            updated_at: NotSet,
            settled_at: NotSet,
        }
        .insert(&transaction)
        .await;
        let prepared = match prepared {
            Ok(prepared) => prepared,
            // Either another writer won the same identity between the lookup
            // and the insert — the retry case, where the fingerprint rule
            // applies to whichever row committed — or the store refused the
            // write to a concurrent transaction, which the caller retries.
            Err(_) => {
                transaction.rollback().await?;
                return self
                    .reuse_committed(&intent.operation_id, &intent.fingerprint)
                    .await;
            }
        };
        transaction.commit().await?;
        Ok(PreparedOperation {
            operation: operation(prepared),
            reused: false,
        })
    }

    async fn reuse_committed(
        &self,
        operation_id: &str,
        fingerprint: &str,
    ) -> Result<PreparedOperation, WorkspaceOperationError> {
        // No committed row means the insert lost the write lock rather than
        // the identity. That is a transient store answer, so it is reported as
        // one and the caller prepares again.
        let existing = operation_entity::Entity::find_by_id(operation_id)
            .one(self.database())
            .await?
            .map(operation)
            .ok_or_else(|| {
                WorkspaceOperationError::new(
                    WorkspaceOperationErrorCode::Storage,
                    "The Workspace Operation could not be prepared while the store was busy.",
                )
            })?;
        if existing.intent_fingerprint != fingerprint {
            return Err(WorkspaceOperationError::new(
                WorkspaceOperationErrorCode::FingerprintConflict,
                "The Workspace Operation identity is already durable under different intent.",
            ));
        }
        Ok(PreparedOperation {
            operation: existing,
            reused: true,
        })
    }

    /// Read one operation by identity. Used by callers replaying a request and
    /// by tests asserting durable state.
    pub async fn find(
        &self,
        operation_id: &str,
    ) -> Result<Option<WorkspaceOperationRecord>, WorkspaceOperationError> {
        let Some(operation_id) = super::intent::database_uuid(operation_id) else {
            return Ok(None);
        };
        Ok(operation_entity::Entity::find_by_id(&operation_id)
            .one(self.database())
            .await?
            .map(operation))
    }
}
