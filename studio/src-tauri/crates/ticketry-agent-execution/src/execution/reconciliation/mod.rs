//! Durable advancement of armed dependency-graph campaigns.

mod runtime;
mod service;
mod types;

pub use runtime::{
    ExecutionReconciliationConfig, ExecutionReconciliationError, ExecutionReconciliationRuntime,
};
pub use service::ExecutionReconciliationService;
pub use types::{ExecutionReconciliationReport, RootReconciliation};
