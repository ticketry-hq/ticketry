//! Current Work Item and runtime facts used by dependency-graph execution.
//!
//! This module does not arm a Graph Run or prepare a launch. It gives later
//! execution services one factual graph read and one set of scheduling rules.

mod error;
mod facts;
mod predicates;
mod types;

pub use error::{GraphFactsError, GraphFactsErrorCode};
pub use facts::{dependency_graph, has_live_work, relevant_armed_roots, scheduling_facts};
pub use predicates::{
    automatic_candidates, automatically_eligible, manual_candidates, manually_startable,
};
pub use types::{
    ChildSchedulingFacts, DependencyGraph, DependencyGraphNode, ExecutionMode, GraphAccess,
    WorkItemFact,
};
