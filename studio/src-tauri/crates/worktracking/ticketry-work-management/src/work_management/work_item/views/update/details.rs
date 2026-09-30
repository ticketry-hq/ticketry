//! Work Item name, description, and classification updates.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{status_facts::WorkFactRecorder, work_items, CommandError};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    name: Option<String>,
    description: Option<String>,
    issue_type_id: Option<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    work_items::update(
        database,
        work_items::UpdateWorkItem {
            id,
            name,
            description,
            issue_type_id,
        },
        facts,
    )
    .await
}
