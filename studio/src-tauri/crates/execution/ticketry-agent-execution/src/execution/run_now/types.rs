use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunNowCaller {
    Human,
    Agent { authenticated_run_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunNowRequest {
    pub id_or_key: String,
    pub request_identity: String,
    pub caller: RunNowCaller,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowState {
    pub id: String,
    pub name: String,
}

/// The issue type the Run Now target has after conversion.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowIssueType {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowRun {
    pub target_id: String,
    pub agent: String,
    pub agent_run_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowSuccess {
    pub target_id: String,
    pub code: String,
    pub detail: String,
    pub remedy: Option<String>,
    pub committed_state: RunNowState,
    pub committed_issue_type: RunNowIssueType,
    pub run: RunNowRun,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowRefusal {
    pub target_id: String,
    pub code: String,
    pub detail: String,
    pub remedy: Option<String>,
    pub committed_state: Option<RunNowState>,
    pub committed_issue_type: Option<RunNowIssueType>,
    pub run: Option<RunNowRun>,
}
