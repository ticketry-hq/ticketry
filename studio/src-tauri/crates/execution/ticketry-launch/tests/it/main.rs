//! Integration tests for the launch slice.
//!
//! Every file in `tests/` links its own binary against the whole
//! dependency graph, so this crate's integration tests share one.

mod interactive_launch_authority;
mod launch_fixture;
mod run_launch_paths;
mod workflow_profile_launch;
