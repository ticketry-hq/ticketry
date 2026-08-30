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
            crate::diagnostics::record_story_move(
                "info",
                "graphql-transition-requested",
                serde_json::json!({"id": id, "target_state_id": target_state_id}),
            );
            let result = workflow::transition(
                database,
                workflow::TransitionWorkItem {
                    id,
                    target_state_id,
                    origin: workflow::TransitionOrigin::Human,
                },
                facts,
            )
            .await;
            match &result {
                Ok(id) => crate::diagnostics::record_story_move(
                    "info",
                    "graphql-transition-succeeded",
                    serde_json::json!({"id": id}),
                ),
                Err(error) => crate::diagnostics::record_story_move(
                    "error",
                    "graphql-transition-failed",
                    serde_json::json!({
                        "code": error.code(),
                        "field": error.field_name(),
                        "from_state": error.from_state(),
                        "to_state": error.to_state(),
                        "message": error.to_string(),
                        "debug": format!("{error:?}"),
                    }),
                ),
            }
            result
        }
        PatchValue::Null => {
            crate::diagnostics::record_story_move(
                "error",
                "graphql-transition-failed",
                serde_json::json!({
                    "id": id,
                    "code": "field_validation",
                    "field": "state_id",
                    "message": "A work item state cannot be cleared.",
                }),
            );
            Err(CommandError::field(
                "state_id",
                "A work item state cannot be cleared.",
            ))
        }
        PatchValue::Unset => unreachable!("route selection requires a state patch"),
    }
}
