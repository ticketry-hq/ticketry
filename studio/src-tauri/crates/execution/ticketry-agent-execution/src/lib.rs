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
mod sprint_suggestions;
pub use sprint_suggestions::{register_sprint_execution_graphql, SprintSuggestionExecutor};

// Each facade names the externally consumed capability and its signature types.
pub use execution::graph::{
    dependency_graph, relevant_armed_roots, scheduling_facts, ChildSchedulingFacts,
    DependencyGraph, DependencyGraphNode, ExecutionMode, GraphAccess, GraphFactsError,
    GraphFactsErrorCode, WorkItemFact,
};
pub use execution::graph_run::register_graphql as register_graph_run_graphql;
pub use execution::launch_delivery::execute as execute_launch_delivery;
pub use execution::merge_preparation_launcher::TerminalMergePreparationLauncher;
pub use execution::persistence::{
    adopt as adopt_execution, preflight as preflight_execution, AdoptionEvidence,
    ExecutionPersistenceError, ExecutionPersistenceErrorCode, SourceClassification, TableEvidence,
    EMPTY_DJANGO_LEAF as EXECUTION_EMPTY_DJANGO_LEAF, VERSION as EXECUTION_SCHEMA_VERSION,
};
pub use execution::reconciliation::{
    ExecutionReconciliationConfig, ExecutionReconciliationError, ExecutionReconciliationReport,
    ExecutionReconciliationRuntime, ExecutionReconciliationService, RootReconciliation,
};
pub use execution::run_now::{
    register_graphql as register_run_now_graphql, RunNowCaller, RunNowIssueType, RunNowLauncher,
    RunNowRefusal, RunNowRequest, RunNowRun, RunNowService, RunNowState, RunNowSuccess,
};
pub use graph_run_service::{
    DeletedGraphRunResult, GraphRunAdvanceResult, GraphRunCaller, GraphRunReadScope,
    GraphRunRequest, GraphRunResult, GraphRunService, GraphRunServiceError,
    GraphRunServiceErrorCode, LaunchedChild, ResetGraphRunResult,
};

/// Validate and migrate persistence for desktop startup.
pub use execution::persistence::ensure_adopted;
