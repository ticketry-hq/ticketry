//! Delete one transition and repair unreachable workflow policy atomically.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{commands::workflow, graphql};

struct DeleteIssueTypeTransition;

#[CustomFields]
impl DeleteIssueTypeTransition {
    async fn delete_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        workflow_revision: i32,
    ) -> Result<bool> {
        workflow::delete_transition(
            graphql::command_database(ctx)?,
            workflow::RevisionedTransition {
                issue_type_id,
                from_state_id,
                to_state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(graphql::command_error)?;
        Ok(true)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<DeleteIssueTypeTransition>();
}
