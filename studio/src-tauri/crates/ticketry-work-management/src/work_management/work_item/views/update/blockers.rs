//! Work Item blocker replacement.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{blockers, workflow::PatchValue, CommandError};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    blocked_by_ids: PatchValue<Vec<String>>,
) -> Result<String, CommandError> {
    match blocked_by_ids {
        PatchValue::Value(ids) => blockers::replace(database, &id, ids).await,
        PatchValue::Null => Err(CommandError::field(
            "blocked_by_ids",
            "Use an empty list to clear blockers.",
        )),
        PatchValue::Unset => unreachable!("route selection requires a blocker patch"),
    }
}
