use sea_orm::entity::prelude::*;

/// One durable receipt for one source-control action, keyed by the
/// caller-supplied operation id.
///
/// Action facts are append-only: the database allows PR state and refresh time
/// to move from open to a terminal merged or closed verdict and nothing else.
/// Raw Git and provider output never reaches this table.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ticketry_shiprecords")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub module_id: String,
    pub task_id: Option<String>,
    pub checkout_kind: String,
    pub checkout_label: String,
    pub operation_id: String,
    pub branch: String,
    pub commit_shas: Json,
    pub steps: Json,
    pub acted_at: String,
    pub pr_url: Option<String>,
    pub pr_number: Option<i32>,
    pub pr_state: Option<String>,
    pub pr_target_branch: Option<String>,
    pub pr_head_commit: Option<String>,
    pub pr_refreshed_at: Option<String>,
    #[sea_orm(belongs_to, from = "module_id", to = "id")]
    pub module: BelongsTo<crate::work_management::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}

/// The append-only write seam for one action receipt.
pub struct AppendReceipt {
    pub module_id: String,
    pub task_id: Option<String>,
    pub checkout_kind: String,
    pub checkout_label: String,
    pub operation_id: String,
    pub branch: String,
    pub commit_shas: Vec<String>,
    pub steps: Vec<serde_json::Value>,
    pub acted_at: String,
    pub pr_url: Option<String>,
    pub pr_number: Option<i32>,
    pub pr_state: Option<String>,
    pub pr_target_branch: Option<String>,
    pub pr_head_commit: Option<String>,
}

/// Typed receipt-persistence failure. The caller still owns the safe
/// in-memory action outcome; this only reports that the durable receipt did
/// not land.
#[derive(Debug)]
pub struct ReceiptError {
    message: String,
}

impl ReceiptError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// Stable transport code. Messages never carry raw Git or provider output.
    pub fn code_str(&self) -> &'static str {
        "ship_receipt_persistence_failed"
    }
}

impl std::fmt::Display for ReceiptError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ReceiptError {}

/// Append one action receipt. A retry with the same (module, operation id)
/// returns the existing receipt instead of writing a second row; any storage
/// failure surfaces as [`ReceiptError`].
pub async fn append(
    database: &sea_orm::DatabaseConnection,
    receipt: AppendReceipt,
) -> Result<Model, ReceiptError> {
    use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};

    if receipt.commit_shas.is_empty()
        || receipt
            .commit_shas
            .iter()
            .any(|sha| sha.len() != 40 || sha != &sha.to_lowercase())
    {
        return Err(ReceiptError::new(
            "ship receipt requires at least one full lowercase commit SHA",
        ));
    }
    let transaction = database
        .begin()
        .await
        .map_err(|error| ReceiptError::new(error.to_string()))?;
    let existing = Entity::find()
        .filter(Column::ModuleId.eq(&receipt.module_id))
        .filter(Column::OperationId.eq(&receipt.operation_id))
        .one(&transaction)
        .await
        .map_err(|error| ReceiptError::new(error.to_string()))?;
    if let Some(existing) = existing {
        transaction
            .commit()
            .await
            .map_err(|error| ReceiptError::new(error.to_string()))?;
        return Ok(existing);
    }
    let pr_state = receipt.pr_state.clone();
    let insert = ActiveModel {
        id: Set(uuid::Uuid::new_v4().simple().to_string()),
        module_id: Set(receipt.module_id),
        task_id: Set(receipt.task_id),
        checkout_kind: Set(receipt.checkout_kind),
        checkout_label: Set(receipt.checkout_label),
        operation_id: Set(receipt.operation_id),
        branch: Set(receipt.branch),
        commit_shas: Set(serde_json::json!(receipt.commit_shas)),
        steps: Set(serde_json::json!(receipt.steps)),
        acted_at: Set(receipt.acted_at),
        pr_url: Set(receipt.pr_url),
        pr_number: Set(receipt.pr_number),
        pr_state: Set(pr_state.clone()),
        pr_target_branch: Set(receipt.pr_target_branch),
        pr_head_commit: Set(receipt.pr_head_commit),
        pr_refreshed_at: Set(pr_state.map(|_| "refreshed-at-pending".to_owned())),
    }
    .insert(&transaction)
    .await
    .map_err(|error| ReceiptError::new(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| ReceiptError::new(error.to_string()))?;
    Ok(insert)
}
