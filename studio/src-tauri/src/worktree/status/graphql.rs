#![allow(non_snake_case)]

//! The authored `worktree_status` query.
//!
//! This is a registered domain query rather than generated model CRUD: two of
//! its three answers (`none` and `no_repo`) have no worktree row at all, and
//! the third reports clean/dirty, ahead/behind, and unmerged facts that live in
//! Git rather than in any column. The generated Worktree read graph remains the
//! contract for the row itself. See the Slice 4 override record for the full
//! reason and the tests that keep this exception narrow.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{WorktreeStatusError, WorktreeStatusService, WorktreeStatusView};

pub struct WorktreeStatusQueries;

#[CustomFields]
impl WorktreeStatusQueries {
    /// Live status for one Work Item. Ownership, repository, and Git facts are
    /// all derived from trusted data; the caller supplies only the identity.
    async fn worktree_status(ctx: &Context<'_>, task_id: String) -> Result<WorktreeStatusView> {
        service(ctx)?
            .status(&task_id)
            .await
            .map_err(worktree_status_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<WorktreeStatusView>();
    builder.register_custom_query::<WorktreeStatusQueries>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a WorktreeStatusService> {
    // Live status prunes checkout rows Git no longer knows about, so it reads and
    // writes through the lease this gate protects.
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<WorktreeStatusService>().map_err(|_| {
        Error::new("Worktree status is unavailable.")
            .extend_with(|_, extension| extension.set("code", "worktree_status_unavailable"))
    })
}

fn worktree_status_error(error: WorktreeStatusError) -> Error {
    let code = error.code_str();
    Error::new(error.to_string())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
