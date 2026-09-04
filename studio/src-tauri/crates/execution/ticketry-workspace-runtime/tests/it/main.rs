//! Integration tests for the workspace-runtime slice.
//!
//! Every file in `tests/` links its own binary against the whole
//! dependency graph, so this crate's integration tests share one.

mod slice4_ownership_handoff;
mod worktree_metadata_adoption;
