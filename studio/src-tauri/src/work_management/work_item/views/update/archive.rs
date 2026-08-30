//! Work Item archive requests.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{
    status_facts::WorkFactRecorder, work_items, workflow::PatchValue, CommandError,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    is_archived: PatchValue<bool>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    match is_archived {
        PatchValue::Value(true) => work_items::archive(database, &id, facts).await,
        PatchValue::Value(false) | PatchValue::Null => Err(CommandError::field(
            "is_archived",
            "Archived work items cannot be restored by this patch.",
        )),
        PatchValue::Unset => unreachable!("route selection requires an archive patch"),
    }
}
