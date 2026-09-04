//! Remove one state from a workflow and repair reachability atomically.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{commands::workflow, graphql};

struct RemoveStateFromIssueTypeWorkflow;

#[CustomFields]
impl RemoveStateFromIssueTypeWorkflow {
    /// Declared exception: workflow membership is reachability, not a row.
    async fn remove_state_from_issue_type_workflow(
        ctx: &Context<'_>,
        issue_type_id: String,
        state_id: String,
        workflow_revision: i32,
    ) -> Result<bool> {
        workflow::remove_state(
            graphql::command_database(ctx)?,
            workflow::RevisionedState {
                issue_type_id,
                state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(graphql::command_error)?;
        Ok(true)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<RemoveStateFromIssueTypeWorkflow>();
}
