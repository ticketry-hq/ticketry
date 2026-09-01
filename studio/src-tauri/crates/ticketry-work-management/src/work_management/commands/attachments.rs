use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};

use super::identifiers::{database_uuid, new_database_uuid};
use super::CommandError;
use ticketry_entities::{attachment, issue};

const RELATIVE_DIRECTORY: &str = "worktracker/attachments";

#[derive(Clone, Debug)]
pub struct AttachmentStorage {
    root: PathBuf,
}

impl AttachmentStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn absolute(&self, relative: &Path) -> PathBuf {
        self.root.join(relative)
    }
}

#[derive(Debug, Clone)]
pub struct CreateAttachment {
    pub issue_id: String,
    pub filename: String,
    pub mime_type: Option<String>,
    pub content: Vec<u8>,
}

pub async fn list(
    database: &DatabaseConnection,
    issue_id: &str,
) -> Result<Vec<attachment::Model>, CommandError> {
    let issue_id = database_uuid(issue_id, "issue_id")?;
    require_issue(database, &issue_id).await?;
    Ok(attachment::Entity::find()
        .filter(attachment::Column::IssueId.eq(issue_id))
        .order_by_asc(attachment::Column::CreatedAt)
        .order_by_asc(attachment::Column::Id)
        .all(database)
        .await?)
}

pub async fn create(
    database: &DatabaseConnection,
    storage: &AttachmentStorage,
    input: CreateAttachment,
) -> Result<attachment::Model, CommandError> {
    let issue_id = database_uuid(&input.issue_id, "issue_id")?;
    require_issue(database, &issue_id).await?;
    let filename = safe_filename(&input.filename)?;
    let size = i32::try_from(input.content.len())
        .map_err(|_| CommandError::field("content_base64", "The attachment is too large."))?;
    let relative_directory = Path::new(RELATIVE_DIRECTORY);
    let directory = storage.absolute(relative_directory);
    fs::create_dir_all(&directory).map_err(|_| {
        CommandError::Storage("The attachment directory is unavailable.".to_owned())
    })?;

    let (relative_path, absolute_path) =
        materialize(&directory, relative_directory, &filename, &input.content)?;
    let model = attachment::ActiveModel {
        id: Set(new_database_uuid()),
        issue_id: Set(issue_id),
        file: Set(relative_path.to_string_lossy().replace('\\', "/")),
        filename: Set(filename),
        mime_type: Set(input.mime_type.unwrap_or_default()),
        size: Set(Some(size)),
        created_at: Set(super::timestamp::now()),
    }
    .insert(database)
    .await;
    match model {
        Ok(model) => Ok(model),
        Err(error) => {
            let _ = fs::remove_file(absolute_path);
            Err(CommandError::Database(error))
        }
    }
}

async fn require_issue(database: &DatabaseConnection, id: &str) -> Result<(), CommandError> {
    if issue::Entity::find_by_id(id).one(database).await?.is_none() {
        return Err(CommandError::NotFound("Work item not found.".to_owned()));
    }
    Ok(())
}

fn safe_filename(value: &str) -> Result<String, CommandError> {
    let filename = Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim();
    if filename.is_empty() || filename == "." || filename == ".." {
        return Err(CommandError::field("filename", "Enter a valid filename."));
    }
    if filename.chars().count() > 512 {
        return Err(CommandError::field(
            "filename",
            "Ensure this field has no more than 512 characters.",
        ));
    }
    Ok(filename.to_owned())
}

fn materialize(
    directory: &Path,
    relative_directory: &Path,
    filename: &str,
    content: &[u8],
) -> Result<(PathBuf, PathBuf), CommandError> {
    let source = Path::new(filename);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let extension = source.extension().and_then(|value| value.to_str());
    for attempt in 0..16 {
        let candidate = if attempt == 0 {
            filename.to_owned()
        } else if let Some(extension) = extension {
            format!("{stem}_{}.{}", &new_database_uuid()[..7], extension)
        } else {
            format!("{stem}_{}", &new_database_uuid()[..7])
        };
        let absolute = directory.join(&candidate);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&absolute)
        {
            Ok(mut file) => {
                if file
                    .write_all(content)
                    .and_then(|_| file.sync_all())
                    .is_err()
                {
                    let _ = fs::remove_file(&absolute);
                    return Err(CommandError::Storage(
                        "The attachment could not be materialized.".to_owned(),
                    ));
                }
                return Ok((relative_directory.join(candidate), absolute));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(CommandError::Storage(
                    "The attachment could not be materialized.".to_owned(),
                ))
            }
        }
    }
    Err(CommandError::Storage(
        "A unique attachment filename could not be allocated.".to_owned(),
    ))
}
