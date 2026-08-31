//! Update one transition under a revision guard.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::entities::work_management::issue_type_transition;
use crate::work_management::{commands::workflow, graphql};

struct UpdateIssueTypeTransition;

#[CustomFields]
impl UpdateIssueTypeTransition {
    async fn update_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        agent_allowed: bool,
        workflow_revision: i32,
    ) -> Result<issue_type_transition::Model> {
        let database = graphql::command_database(ctx)?;
        let id = workflow::update_transition(
            database,
            workflow::TransitionPatch {
                issue_type_id,
                from_state_id,
                to_state_id,
                agent_allowed,
                workflow_revision,
            },
        )
        .await
        .map_err(graphql::command_error)?;
        graphql::authoritative_transition(database, id).await
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<UpdateIssueTypeTransition>();
}
