use super::{
    dispatch::DispatchOutput, public_id::hyphenate, scope, workflow_tools::string, RunPrincipal,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};
use std::path::Path;
use ticketry_work_management::commands::{attachments, CommandError};

pub(super) async fn attach_file(
    database: &DatabaseConnection,
    storage: &attachments::AttachmentStorage,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    scope::project(database, principal, string(arguments, "project_id")?).await?;
    let task = scope::task(database, principal, string(arguments, "task_id")?).await?;
    let path = Path::new(string(arguments, "file_path")?);
    if !path.is_file() {
        return Ok(DispatchOutput::direct(
            json!({"success": false, "message": "File not found", "data": null}),
        ));
    }
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_owned();
    let content = std::fs::read(path)
        .map_err(|_| CommandError::Storage("Could not read attachment file.".to_owned()))?;
    let row = attachments::create(
        database,
        storage,
        attachments::CreateAttachment {
            issue_id: task.id,
            filename,
            mime_type: Some("application/octet-stream".to_owned()),
            content,
        },
    )
    .await?;
    Ok(DispatchOutput::direct(
        json!({"success": true, "message": "Attached", "data": {"asset_id": hyphenate(&row.id)}}),
    ))
}
