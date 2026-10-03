//! Plan a Work Item into a Sprint, or return it to the Backlog with `null`.

use sea_orm::DatabaseConnection;

use crate::work_management::commands::{
    sprints, status_facts::WorkFactRecorder, workflow::PatchValue, CommandError,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    sprint_id: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    sprints::plan_work_item(database, &id, sprint_id, facts).await
}
