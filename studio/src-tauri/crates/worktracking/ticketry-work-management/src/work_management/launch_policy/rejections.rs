//! The launch-policy rejection ledger.
//!
//! A rejection records why an occurrence did not become a launch decision. Most
//! reasons describe configuration the user can still correct — a deactivated
//! provider, an unlinked module folder, a catalogue entry that moved — so the row is
//! a diagnosis, not a verdict: the occurrence stays eligible for re-resolution
//! until it either succeeds or fails for a reason no configuration can repair.

use std::collections::HashMap;

use sea_orm::{
    sea_query::{Expr, OnConflict},
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, NotSet, QueryFilter, QueryOrder,
    QuerySelect, Schema, Set,
};
use serde::Serialize;

use super::rows::{canonical_uuid, compact_uuid};
use super::LaunchPolicyError;
use ticketry_entities::{launch_policy_rejection, transition_occurrence};

/// Codes describing a fixable configuration state. Reactivating the provider,
/// linking the Module's folder, or repairing the binding must let the pending
/// occurrence launch, so these rejections never retire the occurrence.
pub const RECOVERABLE_CODES: &[&str] = &[
    "agent_not_configured",
    "auto_start_not_enabled",
    "binding_not_configured",
    "invalid_required_skills",
    "launch_context_incomplete",
    "launch_policy_storage_failed",
    "model_required",
    "module_folder_unusable",
    "module_not_found",
    "prompt_not_configured",
    "provider_not_activated",
    "unattended_launch_unsupported",
    "unknown_agent",
    "unsupported_model",
    "unsupported_reasoning",
];

/// A recoverable rejection is re-resolved no sooner than this after its last
/// attempt, so an occurrence nobody ever fixes cannot spin the resolver on
/// every reconcile pass.
pub(super) const RETRY_BACKOFF_SECONDS: i64 = 60;

pub fn is_recoverable(code: &str) -> bool {
    RECOVERABLE_CODES.contains(&code)
}

pub(super) async fn ensure_schema(database: &impl ConnectionTrait) -> Result<(), sea_orm::DbErr> {
    let schema = Schema::new(database.get_database_backend());
    let mut table = schema.create_table_from_entity(launch_policy_rejection::Entity);
    table.if_not_exists();
    database.execute(&table).await?;
    Ok(())
}

/// Record the newest diagnosis for an occurrence. A repeat rejection overwrites
/// the previous code and message: the ledger answers "why is this not launching
/// now", not "why did it once fail".
pub(super) async fn record(
    database: &DatabaseConnection,
    caller_scope: &str,
    idempotency_key: &str,
    error: &LaunchPolicyError,
) -> Result<(), LaunchPolicyError> {
    launch_policy_rejection::Entity::insert(launch_policy_rejection::ActiveModel {
        caller_scope: Set(caller_scope.to_owned()),
        idempotency_key: Set(idempotency_key.to_owned()),
        code: Set(error.code().to_owned()),
        message: Set(error.to_string()),
        rejected_at: NotSet,
    })
    .on_conflict(
        OnConflict::columns([
            launch_policy_rejection::Column::CallerScope,
            launch_policy_rejection::Column::IdempotencyKey,
        ])
        .update_columns([
            launch_policy_rejection::Column::Code,
            launch_policy_rejection::Column::Message,
        ])
        .value(
            launch_policy_rejection::Column::RejectedAt,
            Expr::current_timestamp(),
        )
        .to_owned(),
    )
    .exec_without_returning(database)
    .await?;
    Ok(())
}

/// Retire the diagnosis once the occurrence resolves, so a repaired
/// configuration stops reporting the failure it already recovered from.
pub(super) async fn clear(
    database: &DatabaseConnection,
    caller_scope: &str,
    idempotency_key: &str,
) -> Result<(), LaunchPolicyError> {
    launch_policy_rejection::Entity::delete_many()
        .filter(launch_policy_rejection::Column::CallerScope.eq(caller_scope))
        .filter(launch_policy_rejection::Column::IdempotencyKey.eq(idempotency_key))
        .exec(database)
        .await?;
    Ok(())
}

/// Idempotency keys whose last rejection is recoverable and old enough to try
/// again.
pub(super) async fn retryable_keys(
    database: &DatabaseConnection,
    caller_scope: &str,
    limit: u64,
) -> Result<Vec<String>, LaunchPolicyError> {
    let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::seconds(RETRY_BACKOFF_SECONDS);
    Ok(launch_policy_rejection::Entity::find()
        .select_only()
        .column(launch_policy_rejection::Column::IdempotencyKey)
        .filter(launch_policy_rejection::Column::CallerScope.eq(caller_scope))
        .filter(launch_policy_rejection::Column::Code.is_in(RECOVERABLE_CODES.iter().copied()))
        .filter(launch_policy_rejection::Column::RejectedAt.lte(cutoff))
        .order_by_asc(launch_policy_rejection::Column::RejectedAt)
        .limit(limit)
        .into_tuple::<String>()
        .all(database)
        .await?)
}

/// One unlaunched auto-start occurrence, with the reason it has not launched.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LaunchPolicyRejection {
    pub work_item_id: String,
    pub occurrence_id: String,
    pub destination_state_id: String,
    pub code: String,
    pub message: String,
    /// `true` when repairing configuration will let the occurrence launch.
    pub recoverable: bool,
    pub rejected_at: String,
}

/// Read the ledger for one work item, newest rejection first. Only auto-start
/// rejections are addressable this way: interactive and subtree requests carry
/// caller-minted idempotency keys that name no occurrence.
pub async fn for_work_item(
    database: &DatabaseConnection,
    work_item_id: &str,
) -> Result<Vec<LaunchPolicyRejection>, LaunchPolicyError> {
    let occurrences = transition_occurrence::Entity::find()
        .filter(transition_occurrence::Column::IssueId.eq(compact_uuid(work_item_id)))
        .filter(transition_occurrence::Column::DestinationAutoStart.eq(true))
        .all(database)
        .await?;
    if occurrences.is_empty() {
        return Ok(Vec::new());
    }
    let keys: Vec<String> = occurrences
        .iter()
        .map(|occurrence| occurrence.occurrence_id.clone())
        .collect();
    let states: HashMap<&str, &str> = occurrences
        .iter()
        .map(|occurrence| {
            (
                occurrence.occurrence_id.as_str(),
                occurrence.to_state_id.as_str(),
            )
        })
        .collect();
    let rows = launch_policy_rejection::Entity::find()
        .filter(
            launch_policy_rejection::Column::CallerScope.eq(super::CallerScope::AutoStart.as_str()),
        )
        .filter(launch_policy_rejection::Column::IdempotencyKey.is_in(keys))
        .order_by_desc(launch_policy_rejection::Column::RejectedAt)
        .all(database)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| LaunchPolicyRejection {
            work_item_id: canonical_uuid(work_item_id),
            destination_state_id: states
                .get(row.idempotency_key.as_str())
                .map(|state| canonical_uuid(state))
                .unwrap_or_default(),
            occurrence_id: row.idempotency_key,
            recoverable: is_recoverable(&row.code),
            code: row.code,
            message: row.message,
            rejected_at: format!("{}Z", row.rejected_at.format("%Y-%m-%dT%H:%M:%S%.f")),
        })
        .collect())
}
