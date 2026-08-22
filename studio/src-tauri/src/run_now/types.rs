use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RunNowCaller {
    Human,
    Agent { authenticated_run_id: String },
}

impl RunNowCaller {
    pub(crate) fn excluded_run_id(&self) -> Option<&str> {
        match self {
            Self::Human => None,
            Self::Agent {
                authenticated_run_id,
            } => Some(authenticated_run_id),
        }
    }
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
    pub run: RunNowRun,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunNowRefusal {
    pub target_id: String,
    pub code: String,
    pub detail: String,
    pub remedy: Option<String>,
    pub committed_state: Option<RunNowState>,
    pub run: Option<RunNowRun>,
}
