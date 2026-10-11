//! Execution capability: dependency graph, run persistence, and reconciliation.

pub(crate) mod graph;
pub(crate) mod graph_run;
mod handoff;
pub(crate) mod launch_delivery;
pub(crate) mod merge_preparation_launcher;
pub(crate) mod persistence;
pub(crate) mod reconciliation;
mod replacement;
pub(crate) mod run_now;
mod stage_skills;
