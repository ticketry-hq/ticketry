//! Durable evidence recorded *between* an operation's external steps.
//!
//! Most operations are one external effect, so their evidence is written once,
//! at settlement. An operation that performs an ordered sequence of external
//! effects — merge, advance a ref, remove a checkout, delete a branch — needs
//! more: after the branch is gone, no later pass can re-derive what its tip
//! was, and a missing branch is not on its own proof that anything landed.
//!
//! A checkpoint is the narrow answer. It records what the *world* showed
//! between two steps, under the lease of the worker that observed it, so a
//! restart can prove a boundary instead of inferring one. It never changes the
//! operation's state, never settles it, and never records intent: a checkpoint
//! is evidence, not permission.

use chrono::Utc;
use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde_json::{Map, Value};

use super::entities::operation as operation_entity;
use super::records::operation;
use super::{
    claim::validate_owner, intent, sanitize, timestamp, WorkspaceOperationError,
    WorkspaceOperationErrorCode, WorkspaceOperationRecord, WorkspaceOperationJournal,
};

/// The evidence key checkpoints accumulate under, so a settlement's own
/// evidence and the boundary evidence that preceded it stay distinguishable.
pub const CHECKPOINT_KEY: &str = "checkpoint";

impl WorkspaceOperationJournal {
    /// Record one boundary observation under the caller's live lease.
    ///
    /// Keys are merged into whatever the operation already proved, so each step
    /// adds to the record rather than erasing the step before it. An operation
    /// that is not leased by this owner is left untouched: evidence may only be
    /// written by the worker currently acting.
    pub async fn record_checkpoint(
        &self,
        operation_id: &str,
        lease_owner: &str,
        observation: Value,
    ) -> Result<WorkspaceOperationRecord, WorkspaceOperationError> {
        validate_owner(lease_owner)?;
        if !observation.is_object() {
            return Err(WorkspaceOperationError::invalid(
                "A Workspace Operation checkpoint requires an evidence object.",
            ));
        }
        let operation_id = intent::database_uuid(operation_id).ok_or_else(|| {
            WorkspaceOperationError::invalid("The Workspace Operation ID is not a UUID.")
        })?;

        let transaction = self.database().begin().await?;
        let current = operation_entity::Entity::find_by_id(&operation_id)
            .one(&transaction)
            .await?
            .map(operation)
            .ok_or_else(WorkspaceOperationError::not_found)?;
        if current.state != "leased" || current.lease_owner.as_deref() != Some(lease_owner) {
            transaction.rollback().await?;
            return Err(WorkspaceOperationError::new(
                WorkspaceOperationErrorCode::LeaseNotHeld,
                "Recording Workspace Operation evidence requires the lease held by its observer.",
            ));
        }

        let observed_at = timestamp::database_format(Utc::now());
        let evidence = merged(&current, &observation, &observed_at);
        operation_entity::Entity::update_many()
            .filter(operation_entity::Column::OperationId.eq(&operation_id))
            .col_expr(
                operation_entity::Column::Evidence,
                Expr::value(evidence.to_string()),
            )
            .col_expr(
                operation_entity::Column::UpdatedAt,
                Expr::value(observed_at.clone()),
            )
            .exec(&transaction)
            .await?;
        let updated = operation_entity::Entity::find_by_id(&operation_id)
            .one(&transaction)
            .await?
            .map(operation)
            .ok_or_else(WorkspaceOperationError::not_found)?;
        transaction.commit().await?;
        Ok(updated)
    }
}

impl WorkspaceOperationRecord {
    /// The boundary evidence recorded so far, as a later pass reads it back.
    /// An operation with no checkpoints reads as an empty object rather than
    /// absence, so a caller never has to distinguish "nothing yet" from
    /// "unreadable".
    pub fn checkpoint(&self) -> Value {
        self.evidence_value()
            .and_then(|evidence| evidence.get(CHECKPOINT_KEY).cloned())
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Map::new()))
    }
}

/// The operation's evidence with this observation folded into its checkpoint.
fn merged(current: &WorkspaceOperationRecord, observation: &Value, observed_at: &str) -> Value {
    let mut evidence = match current.evidence_value() {
        Some(Value::Object(entries)) => entries,
        _ => Map::new(),
    };
    let mut checkpoint = match evidence.get(CHECKPOINT_KEY) {
        Some(Value::Object(entries)) => entries.clone(),
        _ => Map::new(),
    };
    if let Value::Object(entries) = sanitize::redact(observation) {
        for (key, value) in entries {
            checkpoint.insert(key, value);
        }
    }
    checkpoint.insert(
        "observedAt".to_owned(),
        Value::String(observed_at.to_owned()),
    );
    evidence.insert(CHECKPOINT_KEY.to_owned(), Value::Object(checkpoint));
    Value::Object(evidence)
}
