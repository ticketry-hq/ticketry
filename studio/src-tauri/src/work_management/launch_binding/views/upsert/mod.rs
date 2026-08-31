//! Create or patch one Launch Binding under a revision guard.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{
    commands::workflow,
    graphql::{self, GraphqlPatchBool, GraphqlPatchString, GraphqlPatchStringList},
};
use ticketry_entities::work_management::launch_binding;

struct UpsertIssueTypeLaunchBinding;

#[CustomFields]
impl UpsertIssueTypeLaunchBinding {
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
    ) -> Result<launch_binding::Model> {
        let database = graphql::command_database(ctx)?;
        let id = workflow::patch_launch_binding(
            database,
            workflow::PatchLaunchBinding {
                issue_type_id,
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
        .map_err(graphql::command_error)?;
        graphql::authoritative_launch_binding(database, id).await
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<UpsertIssueTypeLaunchBinding>();
}
