//! Work Item workspace tab-order updates.

use sea_orm::DatabaseConnection;

use crate::work_management::{
    commands::{status_facts::WorkFactRecorder, workflow::PatchValue, CommandError},
    workspace_tab_order,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    order: PatchValue<serde_json::Value>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    match order {
        PatchValue::Value(order) => workspace_tab_order::update(database, &id, order, facts).await,
        PatchValue::Null => Err(CommandError::field(
            "workspace_tab_order",
            "Workspace tab order cannot be null.",
        )),
        PatchValue::Unset => unreachable!("route selection requires a tab-order patch"),
    }
}
