//! Attaching a local file to a work item through the attachments command.

use std::path::Path;

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use ticketry_work_management::commands::{attachments, CommandError};

use super::{
    public_id::hyphenate,
    scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default().with(TypedTool::new(
        "attach_file",
        "Attach a local file to a task.",
        attach_file,
    ))
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct Attachment {
    project_id: String,
    task_id: String,
    file_path: String,
}

async fn attach_file(call: ToolCall, request: Attachment) -> Result<Value, CommandError> {
    let database = &call.database;
    scope::project(database, &call.principal, &request.project_id).await?;
    let task = scope::task(database, &call.principal, &request.task_id).await?;
    let path = Path::new(&request.file_path);
    if !path.is_file() {
        return Ok(json!({"success": false, "message": "File not found", "data": null}));
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
        &call.storage,
        attachments::CreateAttachment {
            issue_id: task.id,
            filename,
            mime_type: Some("application/octet-stream".to_owned()),
            content,
        },
    )
    .await?;
    Ok(json!({"success": true, "message": "Attached", "data": {"asset_id": hyphenate(&row.id)}}))
}
