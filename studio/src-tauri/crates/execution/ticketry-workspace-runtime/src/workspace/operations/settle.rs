//! The settlement transaction.
//!
//! Settling is where the journal and the world it describes are reconciled in
//! one SQLite transaction: the operation reaches its typed outcome and the
//! caller's own model rows and durable facts commit with it, or neither does.
//! A rejected or no-op settlement writes nothing, so a retried acknowledgement
//! can never append a second fact.
//!
//! Retryability is a state, not a flag a caller re-reads: a retryable failure
//! whose cleanup is confirmed returns the operation to `prepared` under the
//! same identity, an unconfirmed one becomes `cleanup_pending`, and everything
//! else settles with its evidence retained.

use std::future::Future;
use std::pin::Pin;

use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::Value;

use super::entities::operation as operation_entity;
use super::records::operation;
use super::{
    claim::validate_owner, intent, sanitize, timestamp, WorkspaceOperationError,
    WorkspaceOperationErrorCode, WorkspaceOperationJournal, WorkspaceOperationRecord,
};

const MAX_CODE: usize = 64;
const MAX_MESSAGE: usize = 2000;

/// What one attempt proved.
#[derive(Clone, Debug, PartialEq)]
pub enum WorkspaceOperationOutcome {
    /// The external effect is durable. `result` is the replayable summary a
    /// later request reusing the identity receives.
    Applied { result: Value, evidence: Value },
    /// External state contradicts the immutable intent. It is never
    /// overwritten or retried, because retrying could only duplicate or
    /// destroy the contradicting thing.
    Conflicted {
        code: String,
        message: String,
        evidence: Value,
    },
    Failed {
        code: String,
        message: String,
        /// Whether the same intent may be attempted again under this identity.
        retryable: bool,
        /// False when the attempt could not prove that a partial external
        /// effect is gone. The operation then stays cleanup-pending.
        cleanup_confirmed: bool,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettledOperation {
    pub operation: WorkspaceOperationRecord,
    /// False when the operation already held this outcome and nothing was
    /// written. A retried acknowledgement is a no-op, not a second fact.
    pub settled: bool,
}

/// The caller's half of the settlement transaction: the model update and
/// durable fact that must commit with the operation or not at all.
pub type Settlement<'t> =
    Pin<Box<dyn Future<Output = Result<(), WorkspaceOperationError>> + Send + 't>>;

impl WorkspaceOperationJournal {
    /// Settle an operation on its own.
    pub async fn settle(
        &self,
        operation_id: &str,
        lease_owner: &str,
        outcome: WorkspaceOperationOutcome,
    ) -> Result<SettledOperation, WorkspaceOperationError> {
        self.settle_with(operation_id, lease_owner, outcome, |_| {
            Box::pin(async { Ok(()) })
        })
        .await
    }

    /// Settle an operation together with the caller's own committed work.
    /// `settlement` runs inside the same transaction and may abort it by
    /// returning an error, in which case the operation is left untouched.
    pub async fn settle_with<F>(
        &self,
        operation_id: &str,
        lease_owner: &str,
        outcome: WorkspaceOperationOutcome,
        settlement: F,
    ) -> Result<SettledOperation, WorkspaceOperationError>
    where
        F: for<'t> FnOnce(&'t DatabaseTransaction) -> Settlement<'t> + Send,
    {
        // SQLite deferred transactions can otherwise race when independent
        // repository operations settle against the shared journal.
        let _write_guard = self.lock_write().await;
        validate_owner(lease_owner)?;
        let outcome = validated(outcome)?;
        let operation_id = intent::database_uuid(operation_id).ok_or_else(|| {
            WorkspaceOperationError::invalid("The Workspace Operation ID is not a UUID.")
        })?;

        let transaction = self.database().begin().await?;
        let current = load(&transaction, &operation_id).await?;
        if let Some(settled) = already_settled(&current, &outcome)? {
            transaction.commit().await?;
            return Ok(SettledOperation {
                operation: settled,
                settled: false,
            });
        }
        validate_lease(&current, lease_owner)?;

        let now = timestamp::database_format(Utc::now());
        apply(&transaction, &operation_id, &outcome, &now).await?;
        settlement(&transaction).await?;
        let operation = load(&transaction, &operation_id).await?;
        transaction.commit().await?;
        Ok(SettledOperation {
            operation,
            settled: true,
        })
    }
}

async fn apply(
    transaction: &DatabaseTransaction,
    operation_id: &str,
    outcome: &WorkspaceOperationOutcome,
    now: &str,
) -> Result<(), WorkspaceOperationError> {
    let mut update = operation_entity::Entity::update_many()
        .filter(operation_entity::Column::OperationId.eq(operation_id))
        .col_expr(operation_entity::Column::UpdatedAt, Expr::value(now))
        .col_expr(
            operation_entity::Column::LeaseOwner,
            Expr::value(None::<String>),
        )
        .col_expr(
            operation_entity::Column::LeaseExpiresAt,
            Expr::value(None::<String>),
        );
    update = match outcome {
        WorkspaceOperationOutcome::Applied { result, evidence } => update
            .col_expr(operation_entity::Column::State, Expr::value("applied"))
            .col_expr(operation_entity::Column::SettledAt, Expr::value(now))
            .col_expr(
                operation_entity::Column::ResultSummary,
                Expr::value(sanitize::redact(result).to_string()),
            )
            .col_expr(
                operation_entity::Column::Evidence,
                Expr::value(sanitize::redact(evidence).to_string()),
            )
            .col_expr(
                operation_entity::Column::LastErrorCode,
                Expr::value(None::<String>),
            )
            .col_expr(
                operation_entity::Column::LastErrorMessage,
                Expr::value(None::<String>),
            ),
        WorkspaceOperationOutcome::Conflicted {
            code,
            message,
            evidence,
        } => update
            .col_expr(operation_entity::Column::State, Expr::value("conflicted"))
            .col_expr(operation_entity::Column::SettledAt, Expr::value(now))
            .col_expr(
                operation_entity::Column::Evidence,
                Expr::value(sanitize::redact(evidence).to_string()),
            )
            .col_expr(
                operation_entity::Column::LastErrorCode,
                Expr::value(code.as_str()),
            )
            .col_expr(
                operation_entity::Column::LastErrorMessage,
                Expr::value(sanitize::redact_text(message, MAX_MESSAGE)),
            ),
        WorkspaceOperationOutcome::Failed {
            code,
            message,
            retryable,
            cleanup_confirmed,
        } => {
            // Retryable absence returns to processing under the same identity;
            // an unproven external effect keeps the operation cleanup-pending
            // until a probe proves it gone.
            let (state, settled_at) = match (cleanup_confirmed, retryable) {
                (false, _) => ("cleanup_pending", None),
                (true, true) => ("prepared", None),
                (true, false) => ("failed", Some(now.to_owned())),
            };
            update
                .col_expr(operation_entity::Column::State, Expr::value(state))
                .col_expr(operation_entity::Column::SettledAt, Expr::value(settled_at))
                .col_expr(
                    operation_entity::Column::LastErrorCode,
                    Expr::value(code.as_str()),
                )
                .col_expr(
                    operation_entity::Column::LastErrorMessage,
                    Expr::value(sanitize::redact_text(message, MAX_MESSAGE)),
                )
        }
    };
    update.exec(transaction).await?;
    Ok(())
}

/// A retried acknowledgement of an outcome the operation already holds is a
/// no-op; a contradicting one is a typed conflict.
fn already_settled(
    current: &WorkspaceOperationRecord,
    outcome: &WorkspaceOperationOutcome,
) -> Result<Option<WorkspaceOperationRecord>, WorkspaceOperationError> {
    let repeated_code = match outcome {
        WorkspaceOperationOutcome::Applied { .. } => None,
        WorkspaceOperationOutcome::Conflicted { code, .. }
        | WorkspaceOperationOutcome::Failed { code, .. } => Some(code.as_str()),
    };
    match (current.state.as_str(), outcome) {
        ("applied", WorkspaceOperationOutcome::Applied { .. }) => Ok(Some(current.clone())),
        (
            "conflicted" | "failed" | "cleanup_pending",
            WorkspaceOperationOutcome::Conflicted { .. } | WorkspaceOperationOutcome::Failed { .. },
        ) if current.last_error_code.as_deref() == repeated_code => Ok(Some(current.clone())),
        ("applied" | "conflicted" | "failed", _) => Err(WorkspaceOperationError::new(
            WorkspaceOperationErrorCode::AlreadySettled,
            "The Workspace Operation already holds a different terminal outcome.",
        )),
        _ => Ok(None),
    }
}

fn validate_lease(
    current: &WorkspaceOperationRecord,
    lease_owner: &str,
) -> Result<(), WorkspaceOperationError> {
    let held = current.state == "leased"
        && current.lease_owner.as_deref() == Some(lease_owner)
        && current
            .lease_expires_at
            .as_deref()
            .is_some_and(|expires| expires > timestamp::database_now().as_str());
    if held {
        return Ok(());
    }
    Err(WorkspaceOperationError::new(
        WorkspaceOperationErrorCode::LeaseNotHeld,
        "Settling a Workspace Operation requires a live lease held by its reporter.",
    ))
}

fn validated(
    outcome: WorkspaceOperationOutcome,
) -> Result<WorkspaceOperationOutcome, WorkspaceOperationError> {
    match &outcome {
        WorkspaceOperationOutcome::Applied { result, evidence }
            if !result.is_object() || !evidence.is_object() =>
        {
            Err(WorkspaceOperationError::invalid(
                "An applied Workspace Operation requires result and evidence objects.",
            ))
        }
        WorkspaceOperationOutcome::Conflicted { evidence, .. } if !evidence.is_object() => Err(
            WorkspaceOperationError::invalid("A conflict requires an evidence object."),
        ),
        WorkspaceOperationOutcome::Conflicted { code, message, .. }
        | WorkspaceOperationOutcome::Failed { code, message, .. }
            if !bounded(code, MAX_CODE) || !bounded(message, MAX_MESSAGE) =>
        {
            Err(WorkspaceOperationError::invalid(
                "A Workspace Operation failure requires a bounded typed code and message.",
            ))
        }
        _ => Ok(outcome),
    }
}

fn bounded(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit
}

async fn load(
    transaction: &DatabaseTransaction,
    operation_id: &str,
) -> Result<WorkspaceOperationRecord, WorkspaceOperationError> {
    operation_entity::Entity::find_by_id(operation_id)
        .one(transaction)
        .await?
        .map(operation)
        .ok_or_else(WorkspaceOperationError::not_found)
}
