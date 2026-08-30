#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{
    ChangedFile, CurrentWorktreeView, ModuleCheckoutChangesView, ModuleVersionControlView,
    PullRequestCreationResult, PullRequestStatusView, RepositoryCommandResult,
    WorkItemClosureFailureView, WorktreeChangesError, WorktreeChangesService, WorktreeChangesView,
    WorktreeCleanupStatusView,
};

pub struct WorktreeChangesQueries;

#[CustomFields]
impl WorktreeChangesQueries {
    /// This is the smallest authored read exception: an exact-base live Git
    /// projection is not a Worktree entity column or relation, so generated
    /// Seaography cannot represent it.
    async fn worktree_changes(ctx: &Context<'_>, task_id: String) -> Result<WorktreeChangesView> {
        service(ctx)?.changes(&task_id).await.map_err(changes_error)
    }

    /// Module Changes and current worktrees contain live Git facts that are
    /// not columns or relations in the generated Worktree graph. This query
    /// only reads those facts and never enters a workflow or Git write path.
    async fn module_version_control(
        ctx: &Context<'_>,
        module_id: String,
    ) -> Result<ModuleVersionControlView> {
        service(ctx)?
            .module_version_control(&module_id)
            .await
            .map_err(changes_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<ChangedFile>();
    builder.register_custom_output::<WorktreeChangesView>();
    builder.register_custom_output::<WorkItemClosureFailureView>();
    builder.register_custom_output::<WorktreeCleanupStatusView>();
    builder.register_custom_output::<PullRequestStatusView>();
    builder.register_custom_output::<ModuleCheckoutChangesView>();
    builder.register_custom_output::<CurrentWorktreeView>();
    builder.register_custom_output::<ModuleVersionControlView>();
    builder.register_custom_output::<RepositoryCommandResult>();
    builder.register_custom_output::<PullRequestCreationResult>();
    builder.register_custom_query::<WorktreeChangesQueries>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeChangesService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<WorktreeChangesService>().map_err(|_| {
        Error::new("Worktree changes are unavailable.")
            .extend_with(|_, extension| extension.set("code", "worktree_changes_unavailable"))
    })
}

fn changes_error(error: WorktreeChangesError) -> Error {
    let code = error.code_str();
    Error::new(error.to_string())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
