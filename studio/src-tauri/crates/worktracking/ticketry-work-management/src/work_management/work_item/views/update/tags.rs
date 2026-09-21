use sea_orm::DatabaseConnection;

use crate::work_management::commands::{
    status_facts::WorkFactRecorder, tags, workflow::PatchValue, CommandError,
};

pub(super) async fn apply(
    database: &DatabaseConnection,
    id: String,
    tag_names: PatchValue<Vec<String>>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    match tag_names {
        PatchValue::Value(names) => tags::add(database, &id, names, facts).await.map(|_| id),
        PatchValue::Null | PatchValue::Unset => unreachable!("tag path requires names"),
    }
}
