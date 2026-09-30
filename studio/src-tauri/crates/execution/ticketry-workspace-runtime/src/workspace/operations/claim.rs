//! Bounded compare-and-set claim over one prepared operation.
//!
//! A claim is concurrency control and nothing else. It tells one worker that
//! no other worker is currently acting, and it hands over only the typed kind,
//! the re-resolvable resource identity, and the immutable intent payload —
//! never a path, command, or credential. Crucially, an expired lease makes a
//! row claimable but is never on its own permission to perform an effect:
//! reconciliation probes external state first.

use chrono::{Duration, Utc};
use sea_orm::{
    sea_query::{Expr, ExprTrait},
    ColumnTrait, Condition, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::Value;

use super::entities::operation as operation_entity;
use super::{
    intent, timestamp, WorkspaceOperationError, WorkspaceOperationErrorCode,
    WorkspaceOperationJournal, WorkspaceOperationKind,
};

/// Leases are bounded so a crashed worker cannot hold an operation forever.
pub const MAX_LEASE_SECONDS: i64 = 900;

/// Everything an executor is allowed to receive.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimedOperation {
    pub operation_id: String,
    pub kind: WorkspaceOperationKind,
    pub resource_key: String,
    /// The validated immutable intent payload, as prepared.
    pub payload: Value,
    pub lease_owner: String,
    pub lease_expires_at: String,
    pub attempt_count: i32,
}

impl WorkspaceOperationJournal {
    pub async fn claim(
        &self,
        operation_id: &str,
        lease_owner: &str,
        lease_seconds: i64,
    ) -> Result<ClaimedOperation, WorkspaceOperationError> {
        validate_owner(lease_owner)?;
        if !(1..=MAX_LEASE_SECONDS).contains(&lease_seconds) {
            return Err(WorkspaceOperationError::invalid(
                "The Workspace Operation lease duration is outside the supported bound.",
            ));
        }
        let operation_id = intent::database_uuid(operation_id).ok_or_else(|| {
            WorkspaceOperationError::invalid("The Workspace Operation ID is not a UUID.")
        })?;
        let now = Utc::now();
        let claimed_at = timestamp::database_format(now);
        let expires_at = timestamp::database_format(now + Duration::seconds(lease_seconds));

        let transaction = self.database().begin().await?;
        // A prepared operation, or one whose lease has expired, is claimable.
        // Every other state loses the compare-and-set and is reported below
        // from the row that actually won.
        let claimable = Condition::any()
            .add(operation_entity::Column::State.eq("prepared"))
            .add(
                Condition::all()
                    .add(operation_entity::Column::State.eq("leased"))
                    .add(operation_entity::Column::LeaseExpiresAt.lt(claimed_at.clone())),
            );
        let claimed = operation_entity::Entity::update_many()
            .col_expr(operation_entity::Column::State, Expr::value("leased"))
            .col_expr(
                operation_entity::Column::LeaseOwner,
                Expr::value(lease_owner),
            )
            .col_expr(
                operation_entity::Column::LeaseExpiresAt,
                Expr::value(expires_at.clone()),
            )
            .col_expr(
                operation_entity::Column::AttemptCount,
                Expr::col(operation_entity::Column::AttemptCount).add(1),
            )
            .col_expr(operation_entity::Column::UpdatedAt, Expr::value(claimed_at))
            .filter(operation_entity::Column::OperationId.eq(&operation_id))
            .filter(claimable)
            .exec(&transaction)
            .await?
            .rows_affected
            == 1;
        let row = operation_entity::Entity::find_by_id(&operation_id)
            .one(&transaction)
            .await?
            .ok_or_else(WorkspaceOperationError::not_found)?;
        if !claimed {
            return Err(WorkspaceOperationError::new(
                match row.state.as_str() {
                    "applied" | "conflicted" | "failed" => {
                        WorkspaceOperationErrorCode::AlreadySettled
                    }
                    _ => WorkspaceOperationErrorCode::Busy,
                },
                match row.state.as_str() {
                    "applied" => "The Workspace Operation has already been applied.",
                    "conflicted" => "The Workspace Operation is settled as conflicted.",
                    "failed" => "The Workspace Operation has already failed.",
                    "cleanup_pending" => "The Workspace Operation is still being cleaned up.",
                    _ => "The Workspace Operation is leased by another worker.",
                },
            ));
        }
        let record = super::records::operation(row);
        let (Some(kind), Some(payload)) = (record.typed_kind(), record.intent_payload()) else {
            // The row was written by a generation whose typed decoder this
            // build does not have. It is never executed on a guess.
            transaction.rollback().await?;
            return Err(WorkspaceOperationError::new(
                WorkspaceOperationErrorCode::UnsupportedVersion,
                "The Workspace Operation intent cannot be decoded by this build.",
            ));
        };
        transaction.commit().await?;
        Ok(ClaimedOperation {
            operation_id: record.operation_id,
            kind,
            resource_key: record.resource_key,
            payload,
            lease_owner: lease_owner.to_owned(),
            lease_expires_at: expires_at,
            attempt_count: record.attempt_count,
        })
    }
}

pub fn validate_owner(lease_owner: &str) -> Result<(), WorkspaceOperationError> {
    if lease_owner.trim().is_empty()
        || lease_owner.len() > 255
        || lease_owner.chars().any(char::is_control)
    {
        return Err(WorkspaceOperationError::invalid(
            "The Workspace Operation lease owner is invalid.",
        ));
    }
    Ok(())
}
