//! The Slice 4 production ownership handoff for Documents and Worktrees.
//!
//! Documents, Worktrees, and the Workspace Operation journal each adopt or
//! author their own schema and carry their own capability manifest. This module
//! is the seam above all three: it composes their ownership into one checked
//! production-writer assignment, validates the live store against it, and
//! publishes one readiness record that says whether the whole workspace runtime
//! is serving.
//!
//! Nothing here writes a document, a worktree, or a journal row. Its only job is
//! to decide — before the write lease changes hands, and again before Studio is
//! told the capability is live — whether this build may own these tables at all.

mod adoption;
mod error;
pub mod gate;
pub mod manifest;
mod readiness;

pub use adoption::{adopt, HandoffEvidence};
pub use error::{WorkspaceHandoffError, WorkspaceHandoffErrorCode};
pub use gate::WorkspaceReadinessGate;
pub use readiness::{
    publish as publish_readiness, published_readiness_is_complete, Slice4Readiness, READINESS_FILE,
};
