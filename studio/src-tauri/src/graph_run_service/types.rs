use crate::entities::execution::graph_run;
use crate::execution_graph::{ExecutionMode, GraphAccess};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphRunRequest {
    pub root_id: String,
    pub access: GraphAccess,
    pub mode: Option<ExecutionMode>,
    pub provider_override: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchedChild {
    pub task_id: String,
    pub agent_run_id: String,
    pub provider: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphRunResult {
    pub graph_run: graph_run::Model,
    pub launched: Vec<LaunchedChild>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphRunAdvanceResult {
    pub root_id: String,
    pub launched: Vec<LaunchedChild>,
    pub terminal_reconciliation_requested: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResetGraphRunResult {
    pub root_id: String,
    pub cleared_task_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeletedGraphRunResult {
    pub graph_run: graph_run::Model,
    pub cleared_task_ids: Vec<String>,
}
