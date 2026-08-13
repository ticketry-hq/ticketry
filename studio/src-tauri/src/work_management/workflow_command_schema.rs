#![allow(non_snake_case)]

//! WorkItem-scoped workflow writes: state transitions and blocker edges.
//!
//! Issue-type workflow rows live in
//! [`super::workflow_configuration_schema`], so this file holds one concern.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use super::command_schema::{authoritative_work_item, command_database, command_error};
use super::commands::{blockers, workflow, CommandError};
use super::read_types as output;

pub struct WorkflowMutations;

#[CustomFields]
impl WorkflowMutations {
    async fn transition_work_item(
        ctx: &Context<'_>,
        id: String,
        target_state_id: String,
        origin: Option<String>,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let origin = match origin.as_deref().unwrap_or("human") {
            "human" => workflow::TransitionOrigin::Human,
            "agent" => workflow::TransitionOrigin::Agent,
            _ => {
                return Err(command_error(CommandError::field(
                    "origin",
                    "Choose human or agent.",
                )))
            }
        };
        let id = workflow::transition(
            database,
            workflow::TransitionWorkItem {
                id,
                target_state_id,
                origin,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn set_work_item_blockers(
        ctx: &Context<'_>,
        id: String,
        blocked_by_ids: output::StringList,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let id = blockers::replace(database, &id, blocked_by_ids.0)
            .await
            .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn add_work_item_blocker(
        ctx: &Context<'_>,
        id: String,
        blocker_id: String,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let mut ids = blockers::list(database, &id).await.map_err(command_error)?;
        ids.push(blocker_id);
        let id = blockers::replace(database, &id, ids)
            .await
            .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn add_work_item_dependent(
        ctx: &Context<'_>,
        id: String,
        dependent_id: String,
    ) -> Result<output::WorkItem> {
        let database = command_database(ctx)?;
        let mut ids = blockers::list(database, &dependent_id)
            .await
            .map_err(command_error)?;
        ids.push(id);
        let dependent_id = blockers::replace(database, &dependent_id, ids)
            .await
            .map_err(command_error)?;
        authoritative_work_item(database, &dependent_id).await
    }
}
