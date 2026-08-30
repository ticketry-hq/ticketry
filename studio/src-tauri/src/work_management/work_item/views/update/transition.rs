//! Work Item workflow transitions.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{
    status_facts::WorkFactRecorder,
    workflow::{self, PatchValue},
    CommandError,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    state_id: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    match state_id {
        PatchValue::Value(target_state_id) => {
            workflow::transition(
                database,
                workflow::TransitionWorkItem {
                    id,
                    target_state_id,
                    origin: workflow::TransitionOrigin::Human,
                },
                facts,
            )
            .await
        }
        PatchValue::Null => Err(CommandError::field(
            "state_id",
            "A work item state cannot be cleared.",
        )),
        PatchValue::Unset => unreachable!("route selection requires a state patch"),
    }
}
