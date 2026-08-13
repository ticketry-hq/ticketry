#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{read_queries as queries, read_types as output};

pub struct WorkManagementQueries;

#[CustomFields]
impl WorkManagementQueries {
    async fn workspace(ctx: &Context<'_>) -> Result<Option<output::Workspace>> {
        queries::workspace(database(ctx)?)
            .await
            .map_err(query_error)
    }

    async fn projects(ctx: &Context<'_>) -> Result<Vec<output::Project>> {
        queries::projects(database(ctx)?).await.map_err(query_error)
    }

    async fn modules(
        ctx: &Context<'_>,
        project_id: String,
        include_archived: Option<bool>,
    ) -> Result<Vec<output::Module>> {
        queries::modules(
            database(ctx)?,
            &project_id,
            include_archived.unwrap_or(false),
        )
        .await
        .map_err(query_error)
    }

    async fn work_items(
        ctx: &Context<'_>,
        project_id: Option<String>,
        module_id: Option<String>,
        state_id: Option<String>,
    ) -> Result<Vec<output::WorkItem>> {
        queries::work_items(
            database(ctx)?,
            project_id.as_deref(),
            module_id.as_deref(),
            state_id.as_deref(),
        )
        .await
        .map_err(query_error)
    }

    async fn work_items_by_ids(
        ctx: &Context<'_>,
        ids: output::StringList,
    ) -> Result<Vec<output::WorkItem>> {
        queries::work_items_by_ids(database(ctx)?, &ids.0)
            .await
            .map_err(query_error)
    }

    async fn work_item(ctx: &Context<'_>, id: String) -> Result<Option<output::WorkItem>> {
        queries::work_item(database(ctx)?, &id)
            .await
            .map_err(query_error)
    }

    async fn states(ctx: &Context<'_>, project_id: String) -> Result<Vec<output::State>> {
        queries::states(database(ctx)?, &project_id)
            .await
            .map_err(query_error)
    }

    async fn issue_types(ctx: &Context<'_>, project_id: String) -> Result<Vec<output::IssueType>> {
        queries::issue_types(database(ctx)?, &project_id)
            .await
            .map_err(query_error)
    }

    async fn issue_type(ctx: &Context<'_>, id: String) -> Result<Option<output::IssueType>> {
        queries::issue_type(database(ctx)?, &id)
            .await
            .map_err(query_error)
    }

    async fn issue_type_transitions(
        ctx: &Context<'_>,
        issue_type_id: String,
    ) -> Result<Vec<output::IssueTypeTransition>> {
        queries::transitions(database(ctx)?, &issue_type_id)
            .await
            .map_err(query_error)
    }

    async fn launch_bindings(
        ctx: &Context<'_>,
        project_id: String,
    ) -> Result<Vec<output::LaunchBinding>> {
        queries::launch_bindings(database(ctx)?, &project_id)
            .await
            .map_err(query_error)
    }

    async fn providers(ctx: &Context<'_>) -> Result<Vec<output::Provider>> {
        queries::providers(database(ctx)?)
            .await
            .map_err(query_error)
    }

    async fn agent_models(ctx: &Context<'_>) -> Result<Vec<output::AgentModel>> {
        queries::agent_models(database(ctx)?)
            .await
            .map_err(query_error)
    }

    async fn reasoning_levels(ctx: &Context<'_>) -> Result<Vec<output::ReasoningLevel>> {
        queries::reasoning_levels(database(ctx)?)
            .await
            .map_err(query_error)
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<output::Workspace>();
    builder.register_custom_output::<output::Project>();
    builder.register_custom_output::<output::Module>();
    builder.register_custom_output::<output::WorkItem>();
    builder.register_custom_output::<output::Attachment>();
    builder.register_custom_output::<output::State>();
    builder.register_custom_output::<output::IssueType>();
    builder.register_custom_output::<output::IssueTypeTransition>();
    builder.register_custom_output::<output::LaunchBinding>();
    builder.register_custom_output::<output::Provider>();
    builder.register_custom_output::<output::AgentModel>();
    builder.register_custom_output::<output::ReasoningLevel>();
    builder.register_custom_query::<WorkManagementQueries>();
    builder.register_custom_query::<super::command_schema::AttachmentQueries>();
    builder.register_custom_mutation::<super::command_schema::WorkManagementMutations>();
    builder.register_custom_mutation::<super::workflow_command_schema::WorkflowMutations>();
    builder.register_custom_mutation::<super::workflow_configuration_schema::WorkflowConfigurationMutations>();
    builder
}

fn database<'a>(ctx: &'a Context<'a>) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<queries::ReadDatabase>()
        .map(|database| &database.0)
        .map_err(|_| {
            Error::new("The WorkTracker read database is unavailable.")
                .extend_with(|_, extension| extension.set("code", "worktracker_read_unavailable"))
        })
}

fn query_error(error: sea_orm::DbErr) -> Error {
    Error::new("The WorkTracker read could not be completed.")
        .extend_with(|_, extension| extension.set("code", "worktracker_read_failed"))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
