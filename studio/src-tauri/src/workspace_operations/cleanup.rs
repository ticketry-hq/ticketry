//! Durable progression of a cleanup-pending operation.
//!
//! A cleanup-pending row is the record of an attempt that failed while a
//! partial external effect might still exist. Nothing here removes an
//! authoritative row on a guess: cleanup either becomes provably complete, or
//! the operation keeps its cleanup-pending state with fresh evidence for the
//! next pass.

use chrono::Utc;
use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde_json::{json, Value};

use super::entities::operation as operation_entity;
use super::records::operation;
use super::{
    intent, sanitize, timestamp, WorkspaceOperationError, WorkspaceOperationJournal,
    WorkspaceOperationRecord,
};

/// What one cleanup pass proved about the external world.
#[derive(Clone, Debug, PartialEq)]
pub enum CleanupProgress {
    /// Nothing survives the failed attempt. The operation becomes a settled
    /// failure and stops being reconciled.
    Complete,
    /// Something survives, or the observation was inconclusive. The operation
    /// keeps its cleanup-pending state and records why.
    Pending { evidence: Value },
}

impl WorkspaceOperationJournal {
    /// Record one cleanup observation. An operation in any other state is
    /// returned untouched, so a repeated pass after cleanup finished is a
    /// no-op rather than a conflict.
    pub async fn record_cleanup_progress(
        &self,
        operation_id: &str,
        progress: CleanupProgress,
    ) -> Result<WorkspaceOperationRecord, WorkspaceOperationError> {
        let operation_id = intent::database_uuid(operation_id).ok_or_else(|| {
            WorkspaceOperationError::invalid("The Workspace Operation ID is not a UUID.")
        })?;
        let observed_at = timestamp::database_format(Utc::now());
        let transaction = self.database().begin().await?;
        let update = operation_entity::Entity::update_many()
            .filter(operation_entity::Column::OperationId.eq(&operation_id))
            .filter(operation_entity::Column::State.eq("cleanup_pending"))
            .col_expr(
                operation_entity::Column::UpdatedAt,
                Expr::value(observed_at.clone()),
            );
        let update = match &progress {
            CleanupProgress::Complete => update
                .col_expr(operation_entity::Column::State, Expr::value("failed"))
                .col_expr(
                    operation_entity::Column::SettledAt,
                    Expr::value(observed_at.clone()),
                )
                .col_expr(
                    operation_entity::Column::Evidence,
                    Expr::value(
                        json!({ "cleanup": "complete", "observedAt": observed_at }).to_string(),
                    ),
                ),
            CleanupProgress::Pending { evidence } => update.col_expr(
                operation_entity::Column::Evidence,
                Expr::value(
                    json!({
                        "cleanup": "pending",
                        "observedAt": observed_at,
                        "observation": sanitize::redact(evidence),
                    })
                    .to_string(),
                ),
            ),
        };
        update.exec(&transaction).await?;
        let record = operation_entity::Entity::find_by_id(&operation_id)
            .one(&transaction)
            .await?
            .map(operation)
            .ok_or_else(WorkspaceOperationError::not_found)?;
        transaction.commit().await?;
        Ok(record)
    }
}
