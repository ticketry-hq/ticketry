#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleFact {
    pub agent_run_id: String,
    pub kind: String,
    pub occurred_at: String,
    pub provider_session_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleAcceptance {
    pub accepted: bool,
    pub known_run: bool,
    pub applied: bool,
    pub state: Option<String>,
    pub occurred_at: String,
    pub event_cursor: Option<i64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalOutcome {
    Exited,
    Lost,
    Terminated,
    Failed,
}

impl TerminalOutcome {
    pub fn status(self) -> &'static str {
        match self {
            Self::Exited => "exited",
            Self::Lost => "lost",
            Self::Terminated => "terminated",
            Self::Failed => "failed",
        }
    }

    pub fn lifecycle_state(self) -> &'static str {
        match self {
            Self::Failed => "error",
            Self::Exited | Self::Lost | Self::Terminated => "exited",
        }
    }

    pub fn public_state(self) -> &'static str {
        match self {
            Self::Lost => "lost",
            Self::Exited | Self::Terminated | Self::Failed => "exited",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalFact {
    pub agent_run_id: String,
    pub outcome: TerminalOutcome,
    pub occurred_at: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalAcceptance {
    pub applied: bool,
    pub state: String,
    pub occurred_at: String,
    pub event_cursor: Option<i64>,
}
