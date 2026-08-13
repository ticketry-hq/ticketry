#![allow(non_snake_case)]

//! Restricted model-shaped writes for the persisted workflow rows.
//!
//! A transition and a launch binding are rows, so each gets create/update (or
//! upsert) and delete bound to its natural key and guarded by
//! `workflow_revision`. Start state is a column on the issue type and rides
//! `update_issue_type`. The one operation here that is not row CRUD is
//! `remove_state_from_issue_type_workflow`, the declared workflow-pruning
//! exception.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use super::command_schema::{
    authoritative_launch_binding, authoritative_transition, command_database, command_error,
};
use super::commands::{state_configuration, workflow};
use super::graphql_patch_input::{GraphqlPatchBool, GraphqlPatchString, GraphqlPatchStringList};
use super::read_types as output;

pub struct WorkflowConfigurationMutations;

#[CustomFields]
impl WorkflowConfigurationMutations {
    async fn create_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        agent_allowed: bool,
        workflow_revision: i32,
    ) -> Result<output::IssueTypeTransition> {
        let database = command_database(ctx)?;
        let id = workflow::create_transition(
            database,
            workflow::NewTransition {
                issue_type_id: issue_type_id.clone(),
                from_state_id,
                to_state_id,
                agent_allowed,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_transition(database, &issue_type_id, id).await
    }

    async fn update_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        agent_allowed: bool,
        workflow_revision: i32,
    ) -> Result<output::IssueTypeTransition> {
        let database = command_database(ctx)?;
        let id = workflow::update_transition(
            database,
            workflow::TransitionPatch {
                issue_type_id: issue_type_id.clone(),
                from_state_id,
                to_state_id,
                agent_allowed,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_transition(database, &issue_type_id, id).await
    }

    async fn delete_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        workflow_revision: i32,
    ) -> Result<bool> {
        workflow::delete_transition(
            command_database(ctx)?,
            workflow::RevisionedTransition {
                issue_type_id,
                from_state_id,
                to_state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        Ok(true)
    }

    /// Declared exception: workflow membership is reachability, not a row.
    async fn remove_state_from_issue_type_workflow(
        ctx: &Context<'_>,
        issue_type_id: String,
        state_id: String,
        workflow_revision: i32,
    ) -> Result<bool> {
        workflow::remove_state(
            command_database(ctx)?,
            workflow::RevisionedState {
                issue_type_id,
                state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        Ok(true)
    }

    async fn upsert_issue_type_launch_binding(
        ctx: &Context<'_>,
        issue_type_id: String,
        state_id: String,
        workflow_revision: i32,
        prompt: GraphqlPatchString,
        required_skills: GraphqlPatchStringList,
        model_id: GraphqlPatchString,
        reasoning_id: GraphqlPatchString,
        auto_start: GraphqlPatchBool,
        subtree_run_enabled: GraphqlPatchBool,
    ) -> Result<output::LaunchBinding> {
        let database = command_database(ctx)?;
        let id = workflow::patch_launch_binding(
            database,
            workflow::PatchLaunchBinding {
                issue_type_id: issue_type_id.clone(),
                state_id,
                workflow_revision,
                prompt: prompt.0,
                required_skills: required_skills.0.map(|value| value.0),
                model_id: model_id.0,
                reasoning_id: reasoning_id.0,
                auto_start: auto_start.0,
                subtree_run_enabled: subtree_run_enabled.0,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_launch_binding(database, &issue_type_id, id).await
    }

    async fn delete_issue_type_launch_binding(
        ctx: &Context<'_>,
        issue_type_id: String,
        state_id: String,
        workflow_revision: i32,
    ) -> Result<bool> {
        workflow::delete_launch_binding(
            command_database(ctx)?,
            workflow::RevisionedState {
                issue_type_id,
                state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        Ok(true)
    }

    async fn delete_state(ctx: &Context<'_>, state_id: String) -> Result<bool> {
        state_configuration::delete_state(command_database(ctx)?, &state_id)
            .await
            .map_err(command_error)?;
        Ok(true)
    }
}
