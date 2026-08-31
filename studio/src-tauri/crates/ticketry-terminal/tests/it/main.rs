//! Integration tests for the terminal slice.
//!
//! Every file in `tests/` links its own binary against the whole
//! dependency graph, so this crate's integration tests share one.

mod crash_safe_launch_reconciliation;
mod terminal_persistence_adoption;
