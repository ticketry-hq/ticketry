//! Execution capability: dependency graph, run persistence, and reconciliation.

pub mod graph;
pub mod graph_run;
mod handoff;
pub mod launch_delivery;
pub mod merge_preparation_launcher;
mod replacement;
pub mod persistence;
pub mod reconciliation;
pub mod run_now;
