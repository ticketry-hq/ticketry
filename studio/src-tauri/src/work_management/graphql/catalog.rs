#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use super::commands::catalog;
use super::read_types as output;
use super::support::{
    authoritative_issue_type, authoritative_issue_types, authoritative_project,
    authoritative_state, authoritative_states, command_database, command_error, work_facts,
};

pub struct CatalogMutations;

#[CustomFields]
impl CatalogMutations {
    async fn acknowledge_onboarding(
        ctx: &Context<'_>,
        project_id: String,
    ) -> Result<super::entities::project::Model> {
        let database = command_database(ctx)?;
        let id = catalog::acknowledge_onboarding(database, &project_id)
            .await
            .map_err(command_error)?;
        authoritative_project(database, &id).await
    }

    async fn create_project(
        ctx: &Context<'_>,
        name: String,
        slug: String,
        description: Option<String>,
    ) -> Result<super::entities::project::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_project(
            database,
            catalog::CreateProject {
                name,
                slug,
                description,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_project(database, &id).await
    }

    async fn update_project(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<super::entities::project::Model> {
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
    ) -> Result<super::entities::state::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_state(
            database,
            catalog::CreateState {
                project_id: project_id.clone(),
                name,
                group,
                color,
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_state(database, &id).await
    }

    async fn update_state(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        group: Option<String>,
        color: Option<String>,
        sort_order: Option<i32>,
    ) -> Result<super::entities::state::Model> {
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
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_state(database, &id).await
    }

    async fn reorder_states(
        ctx: &Context<'_>,
        project_id: String,
        ordered_ids: output::StringList,
    ) -> Result<Vec<super::entities::state::Model>> {
        let database = command_database(ctx)?;
        catalog::reorder_states(database, &project_id, ordered_ids.0, work_facts(ctx))
            .await
            .map_err(command_error)?;
        authoritative_states(database, &project_id).await
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
    ) -> Result<super::entities::issue_type::Model> {
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
        authoritative_issue_type(database, &id).await
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
    ) -> Result<Vec<super::entities::issue_type::Model>> {
        let database = command_database(ctx)?;
        catalog::reorder_issue_types(database, &project_id, ordered_ids.0)
            .await
            .map_err(command_error)?;
        authoritative_issue_types(database, &project_id).await
    }
}
