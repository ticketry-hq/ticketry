//! Cumulative file changes for one task worktree.
//!
//! This authored read is necessary because generated Seaography fields can
//! expose the recorded Worktree row but cannot compute live Git state. The
//! caller supplies only a Work Item identity. Ownership, checkout, recorded
//! base commit, and repository serialization come from trusted backend state.

mod command;
mod command_git;
mod command_result;
mod error;
mod git;
mod github;
mod graphql;
mod lifecycle;
mod merge_preparation;
mod module_baseline;
mod module_service;
mod module_view;
mod pull_request;
mod pull_request_state;
mod repository;
mod service;
mod view;

pub use command_result::RepositoryCommandResult;
pub use error::WorktreeChangesError;
pub use merge_preparation::{
    MergePreparationError, MergePreparationResult, MergePreparationService,
};
pub use pull_request_state::PullRequestStatusView;
pub use service::WorktreeChangesService;
pub use view::{
    ChangedFile, WorkItemClosureFailureView, WorktreeChangesView, WorktreeCleanupStatusView,
};

pub(crate) use github::GithubPort;
use module_view::{CurrentWorktreeView, ModuleCheckoutChangesView, ModuleVersionControlView};
pub(crate) use pull_request::PullRequestCreationResult;

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}

pub(crate) fn assert_merge_preparation_operation_registered() {
    merge_preparation::assert_operation_registered();
}
