//! Create one transition under a revision guard.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{commands::workflow, entities::issue_type_transition, graphql};

struct CreateIssueTypeTransition;

#[CustomFields]
impl CreateIssueTypeTransition {
    async fn create_issue_type_transition(
        ctx: &Context<'_>,
        issue_type_id: String,
        from_state_id: String,
        to_state_id: String,
        agent_allowed: bool,
        workflow_revision: i32,
    ) -> Result<issue_type_transition::Model> {
        let database = graphql::command_database(ctx)?;
        let id = workflow::create_transition(
            database,
            workflow::NewTransition {
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
    builder.register_custom_mutation::<CreateIssueTypeTransition>();
}
