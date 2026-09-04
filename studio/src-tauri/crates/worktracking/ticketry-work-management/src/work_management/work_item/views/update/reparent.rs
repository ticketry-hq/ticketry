//! Work Item hierarchy updates.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{
    hierarchy, status_facts::WorkFactRecorder, workflow::PatchValue, CommandError,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    parent_id: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let parent_id = match parent_id {
        PatchValue::Value(parent_id) => Some(parent_id),
        PatchValue::Null => None,
        PatchValue::Unset => unreachable!("route selection requires a parent patch"),
    };
    hierarchy::reparent(
        database,
        hierarchy::ReparentWorkItem {
            id,
            parent_id,
            before_id: None,
            after_id: None,
        },
        facts,
    )
    .await
}
