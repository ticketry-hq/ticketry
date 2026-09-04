//! Integration tests for the agent-execution slice.
//!
//! Every file in `tests/` links its own binary against the whole
//! dependency graph, so this crate's integration tests share one.

mod execution_graph_facts;
mod run_now_service;
