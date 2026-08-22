use crate::execution_graph::GraphFactsError;
use crate::terminal_launch::TerminalLaunchError;
use crate::work_management::launch_policy::LaunchPolicyError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphRunServiceErrorCode {
    GraphFacts,
    LaunchPolicy,
    ClaimConflict,
    CampaignChanged,
    TerminalLaunch,
    Storage,
}

#[derive(Debug)]
pub struct GraphRunServiceError {
    code: GraphRunServiceErrorCode,
    public_code: String,
    message: String,
}

impl GraphRunServiceError {
    pub(crate) fn new(
        code: GraphRunServiceErrorCode,
        public_code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            public_code: public_code.into(),
            message: message.into(),
        }
    }

    pub const fn code(&self) -> GraphRunServiceErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &str {
        &self.public_code
    }
}

impl std::fmt::Display for GraphRunServiceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for GraphRunServiceError {}

impl From<GraphFactsError> for GraphRunServiceError {
    fn from(error: GraphFactsError) -> Self {
        Self::new(
            GraphRunServiceErrorCode::GraphFacts,
            error.code().as_str(),
            error.to_string(),
        )
    }
}

impl From<LaunchPolicyError> for GraphRunServiceError {
    fn from(error: LaunchPolicyError) -> Self {
        Self::new(
            GraphRunServiceErrorCode::LaunchPolicy,
            error.code(),
            error.to_string(),
        )
    }
}

impl From<TerminalLaunchError> for GraphRunServiceError {
    fn from(error: TerminalLaunchError) -> Self {
        Self::new(
            GraphRunServiceErrorCode::TerminalLaunch,
            error.code_str(),
            error.to_string(),
        )
    }
}

impl From<sea_orm::DbErr> for GraphRunServiceError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::new(
            GraphRunServiceErrorCode::Storage,
            "graph_run_storage_failure",
            format!("Graph Run storage failed: {error}"),
        )
    }
}
