#![deny(private_bounds, private_interfaces)]

//! Running a dependency graph of Work Items as one campaign of agent runs.
//!
//! Everything below this crate decides what a run may be; this crate is where
//! runs actually get driven. [`execution`] holds the campaign machinery: its
//! `graph` reads the durable facts that say which Work Items are ready,
//! blocked or already satisfied; its `persistence` is the graph-run tables and
//! the adoption evidence that lets a restarted process pick a campaign back up;
//! its `run_now` is the single-Work-Item press; its `reconciliation` is the
//! background loop that presses the graph forward as facts change; and
//! `launch_delivery` and `merge_preparation_launcher` are the two seams where a
//! decided launch becomes a real terminal session.
//!
//! [`graph_run_service`] is the serialized front door onto that machinery — one
//! campaign, one claim at a time — offering create, manual press, reset and
//! delete, plus the read scope the assembled GraphQL schema installs so callers
//! see only the campaigns they own.

mod execution;
mod graph_run_service;

// `execution` is the private implementation root. The capability modules
// below are the stable facade used by desktop, MCP, GraphQL, and integration
// tests. In particular, `graph_run` and `run_now` retain their authored
// GraphQL registration seams, while `persistence` retains its feature-free
// adoption seam for installation tests.
pub use execution::{
    graph, graph_run, launch_delivery, merge_preparation_launcher, persistence, reconciliation,
    run_now,
};
pub use graph_run_service::{
    DeletedGraphRunResult, GraphRunAdvanceResult, GraphRunCaller, GraphRunReadScope,
    GraphRunRequest, GraphRunResult, GraphRunService, GraphRunServiceError,
    GraphRunServiceErrorCode, LaunchedChild, ResetGraphRunResult,
};
