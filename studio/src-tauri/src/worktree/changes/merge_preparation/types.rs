use seaography::CustomOutputType;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct MergePreparationResult {
    pub operation_id: String,
    pub top_level_task_id: String,
    pub agent_run_id: String,
    pub agent: String,
    pub branch: String,
    pub pull_request_url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct LaunchedAgent {
    pub agent_run_id: String,
    pub agent: String,
}
