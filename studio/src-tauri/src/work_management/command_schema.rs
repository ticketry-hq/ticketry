#![allow(non_snake_case)]

use base64::Engine;
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::commands::{
    attachments, catalog, hierarchy, reorder, work_items, CommandDatabase, CommandError,
};
use super::read_queries;
use super::read_types as output;

pub struct WorkManagementMutations;

#[CustomFields]
impl WorkManagementMutations {
    async fn acknowledge_onboarding(ctx: &Context<'_>) -> Result<output::Workspace> {
        let database = command_database(ctx)?;
        let id = catalog::acknowledge_onboarding(database)
            .await
            .map_err(command_error)?;
        read_queries::workspace(database)
            .await
            .map_err(read_error)?
            .filter(|workspace| compact_uuid(&workspace.id) == id)
            .ok_or_else(authored_result_missing)
    }

    async fn create_project(
        ctx: &Context<'_>,
        name: String,
        slug: String,
        description: Option<String>,
        workspace_slug: Option<String>,
    ) -> Result<output::Project> {
        let database = command_database(ctx)?;
        let id = catalog::create_project(
            database,
            catalog::CreateProject {
                name,
                slug,
                description,
                workspace_slug,
            },
        )
        .await
        .map_err(command_error)?;
        read_queries::projects(database)
            .await
            .map_err(read_error)?
            .into_iter()
            .find(|project| compact_uuid(&project.id) == id)
            .ok_or_else(authored_result_missing)
    }

    async fn update_project(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<output::Project> {
        let database = command_database(ctx)?;
        let id = catalog::update_project(
            database,
            catalog::UpdateProject {
                id,
                name,
                description,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_project(database, &id).await
    }

    async fn delete_project(ctx: &Context<'_>, id: String) -> Result<bool> {
        catalog::delete_project(command_database(ctx)?, &id)
            .await
            .map_err(command_error)?;
        Ok(true)
    }

    async fn create_state(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        group: String,
        color: Option<String>,
    ) -> Result<output::State> {
        let database = command_database(ctx)?;
        let id = catalog::create_state(
            database,
            catalog::CreateState {
                project_id: project_id.clone(),
                name,
                group,
                color,
            },
        )
        .await
        .map_err(command_error)?;
        read_queries::states(database, &project_id)
            .await
            .map_err(read_error)?
            .into_iter()
            .find(|state| compact_uuid(&state.id) == id)
            .ok_or_else(authored_result_missing)
    }

    async fn update_state(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        group: Option<String>,
        color: Option<String>,
        sort_order: Option<i32>,
    ) -> Result<output::State> {
        let database = command_database(ctx)?;
        let id = catalog::update_state(
            database,
            catalog::UpdateState {
                id,
                name,
                group,
                color,
                sort_order,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_state(database, &id).await
    }

    async fn reorder_states(
        ctx: &Context<'_>,
        project_id: String,
        ordered_ids: output::StringList,
    ) -> Result<Vec<output::State>> {
        let database = command_database(ctx)?;
        catalog::reorder_states(database, &project_id, ordered_ids.0)
            .await
            .map_err(command_error)?;
        read_queries::states(database, &project_id)
            .await
            .map_err(read_error)
    }

    async fn create_issue_type(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        level: String,
        color: Option<String>,
    ) -> Result<output::IssueType> {
        let database = command_database(ctx)?;
        let id = catalog::create_issue_type(
            database,
            catalog::CreateIssueType {
                project_id,
                name,
                level,
                color,
            },
        )
        .await
        .map_err(command_error)?;
        read_queries::issue_type(database, &id)
            .await
            .map_err(read_error)?
            .ok_or_else(authored_result_missing)
    }

    /// Restricted IssueType patch. `start_state_id` is a workflow member, so
    /// supplying it also requires the `workflow_revision` the caller read.
    async fn update_issue_type(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        color: Option<String>,
        sort_order: Option<i32>,
        start_state_id: Option<String>,
        workflow_revision: Option<i32>,
    ) -> Result<output::IssueType> {
        let database = command_database(ctx)?;
        let id = catalog::update_issue_type(
            database,
            catalog::UpdateIssueType {
                id,
                name,
                color,
                sort_order,
                start_state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        read_queries::issue_type(database, &id)
            .await
            .map_err(read_error)?
            .ok_or_else(authored_result_missing)
    }

    async fn delete_issue_type(
        ctx: &Context<'_>,
        id: String,
        reassign_to: Option<String>,
    ) -> Result<bool> {
        catalog::delete_issue_type(command_database(ctx)?, &id, reassign_to.as_deref())
            .await
            .map_err(command_error)?;
        Ok(true)
    }

    async fn reorder_issue_types(
        ctx: &Context<'_>,
        project_id: String,
        ordered_ids: output::StringList,
    ) -> Result<Vec<output::IssueType>> {
        let database = command_database(ctx)?;
        catalog::reorder_issue_types(database, &project_id, ordered_ids.0)
            .await
            .map_err(command_error)?;
        read_queries::issue_types(database, &project_id)
            .await
            .map_err(read_error)
    }

    async fn create_work_item(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        issue_type_id: String,
        description: Option<String>,
        state_id: Option<String>,
        parent_id: Option<String>,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = work_items::create(
            database,
            work_items::CreateWorkItem {
                project_id,
                name,
                issue_type_id,
                description,
                state_id,
                parent_id,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn update_work_item(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
        issue_type_id: Option<String>,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = work_items::update(
            database,
            work_items::UpdateWorkItem {
                id,
                name,
                description,
                issue_type_id,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn archive_work_item(ctx: &Context<'_>, id: String) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = work_items::archive(database, &id)
            .await
            .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn reorder_work_item(
        ctx: &Context<'_>,
        id: String,
        before_id: Option<String>,
        after_id: Option<String>,
        initial_order_ids: Option<output::StringList>,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = reorder::reorder(
            database,
            reorder::ReorderWorkItem {
                id,
                before_id,
                after_id,
                initial_order_ids: initial_order_ids.map(|ids| ids.0),
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn reparent_work_item(
        ctx: &Context<'_>,
        id: String,
        parent_id: Option<String>,
        before_id: Option<String>,
        after_id: Option<String>,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = hierarchy::reparent(
            database,
            hierarchy::ReparentWorkItem {
                id,
                parent_id,
                before_id,
                after_id,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn delete_work_item(ctx: &Context<'_>, id: String) -> Result<bool> {
        work_items::delete(command_database(ctx)?, &id)
            .await
            .map_err(command_error)?;
        Ok(true)
    }

    async fn create_attachment(
        ctx: &Context<'_>,
        issue_id: String,
        filename: String,
        mime_type: Option<String>,
        content_base64: String,
    ) -> Result<output::Attachment> {
        let content = base64::engine::general_purpose::STANDARD
            .decode(content_base64)
            .map_err(|_| {
                command_error(CommandError::field(
                    "content_base64",
                    "Enter valid base64 attachment content.",
                ))
            })?;
        let row = attachments::create(
            command_database(ctx)?,
            attachment_storage(ctx)?,
            attachments::CreateAttachment {
                issue_id,
                filename,
                mime_type,
                content,
            },
        )
        .await
        .map_err(command_error)?;
        Ok(attachment_output(row))
    }
}

pub struct AttachmentQueries;

#[CustomFields]
impl AttachmentQueries {
    async fn attachments(ctx: &Context<'_>, issue_id: String) -> Result<Vec<output::Attachment>> {
        Ok(attachments::list(read_database(ctx)?, &issue_id)
            .await
            .map_err(command_error)?
            .into_iter()
            .map(attachment_output)
            .collect())
    }
}

fn read_database<'a>(ctx: &'a Context<'a>) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<read_queries::ReadDatabase>()
        .map(|database| &database.0)
        .map_err(|_| {
            Error::new("The WorkTracker read database is unavailable.")
                .extend_with(|_, extension| extension.set("code", "worktracker_read_unavailable"))
        })
}

pub(super) async fn authoritative_work_item(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<output::WorkItem> {
    read_queries::authored_issue(database, id)
        .await
        .map_err(|_| {
            Error::new("The authored result could not be read.")
                .extend_with(|_, extension| extension.set("code", "worktracker_read_failed"))
        })?
        .ok_or_else(|| {
            Error::new("The authored result is unavailable.")
                .extend_with(|_, extension| extension.set("code", "not_found"))
        })
}

async fn authoritative_project(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<output::Project> {
    read_queries::projects(database)
        .await
        .map_err(read_error)?
        .into_iter()
        .find(|row| compact_uuid(&row.id) == id)
        .ok_or_else(authored_result_missing)
}

async fn authoritative_state(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<output::State> {
    use sea_orm::EntityTrait;
    let row = super::entities::state::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)?;
    read_queries::states(database, &row.project_id)
        .await
        .map_err(read_error)?
        .into_iter()
        .find(|state| compact_uuid(&state.id) == id)
        .ok_or_else(authored_result_missing)
}

pub(super) fn read_error(_: sea_orm::DbErr) -> Error {
    Error::new("The authored result could not be read.")
        .extend_with(|_, extension| extension.set("code", "worktracker_read_failed"))
}

pub(super) fn authored_result_missing() -> Error {
    Error::new("The authored result is unavailable.")
        .extend_with(|_, extension| extension.set("code", "not_found"))
}

pub(super) fn command_database<'a>(
    ctx: &'a Context<'a>,
) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<CommandDatabase>()
        .map(|database| &database.0)
        .map_err(|_| {
            Error::new(
                "WorkTracker authored commands are not enabled before write ownership transfers.",
            )
            .extend_with(|_, extension| extension.set("code", "worktracker_write_unavailable"))
        })
}

fn attachment_storage<'a>(ctx: &'a Context<'a>) -> Result<&'a attachments::AttachmentStorage> {
    ctx.data::<attachments::AttachmentStorage>().map_err(|_| {
        Error::new("Attachment storage is unavailable.")
            .extend_with(|_, extension| extension.set("code", "storage_unavailable"))
    })
}

pub(super) fn command_error(error: CommandError) -> Error {
    let code = error.code();
    let field = error.field_name();
    let from_state = error.from_state().map(str::to_owned);
    let to_state = error.to_state().map(str::to_owned);
    Error::new(error.to_string()).extend_with(move |_, extension| {
        extension.set("code", code);
        if let Some(field) = field {
            extension.set("field", field);
        }
        if matches!(
            code,
            "illegal_birth"
                | "illegal_transition"
                | "human_only_transition"
                | "unknown_state"
                | "foreign_state"
        ) {
            extension.set("from", from_state);
            extension.set("to", to_state);
        }
    })
}

pub(super) async fn authoritative_transition(
    database: &sea_orm::DatabaseConnection,
    issue_type_id: &str,
    id: i64,
) -> Result<output::IssueTypeTransition> {
    read_queries::transitions(database, issue_type_id)
        .await
        .map_err(read_error)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(authored_result_missing)
}

pub(super) async fn authoritative_launch_binding(
    database: &sea_orm::DatabaseConnection,
    issue_type_id: &str,
    id: i64,
) -> Result<output::LaunchBinding> {
    let issue_type = read_queries::issue_type(database, issue_type_id)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)?;
    read_queries::launch_bindings(database, &issue_type.project)
        .await
        .map_err(read_error)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(authored_result_missing)
}

fn attachment_output(row: super::entities::attachment::Model) -> output::Attachment {
    output::Attachment {
        id: uuid(&row.id),
        issue: uuid(&row.issue_id),
        filename: row.filename,
        mime_type: row.mime_type,
        size: row.size,
        url: format!("/media/{}", row.file),
        created_at: format!("{}Z", row.created_at.format("%Y-%m-%dT%H:%M:%S%.f")),
    }
}

fn uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn compact_uuid(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect()
}
