use sea_orm::DbErr;
use serde::{Deserialize, Serialize};

pub const DECISION_VERSION: i32 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerScope {
    Interactive,
    RunNow,
    AutoStart,
    Subtree,
    /// One explicitly requested retry of a failed Automation Attempt. The
    /// attempt itself is the idempotency key, so a retry is performed exactly
    /// once no matter how often the decision is re-read or re-delivered.
    Retry,
}

impl CallerScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::RunNow => "run_now",
            Self::AutoStart => "auto_start",
            Self::Subtree => "subtree",
            Self::Retry => "retry",
        }
    }

    pub fn unattended(self) -> bool {
        !matches!(self, Self::Interactive | Self::RunNow)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchPolicyRequest {
    pub task_id: String,
    pub destination_state_id: Option<String>,
    pub provider_override: Option<String>,
    pub caller_scope: CallerScope,
    pub idempotency_key: String,
    /// The transition crossed a handoff edge, so the destination is delivered
    /// into the work item's live agent session when it still has one.
    pub handoff: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ModuleLinkInput {
    pub module_id: String,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LaunchPolicyDecision {
    pub version: i32,
    pub decision_id: String,
    pub policy_identity: String,
    pub policy_version: i32,
    pub caller_scope: CallerScope,
    pub idempotency_key: String,
    /// Decisions recorded before handoff existed deserialize as fresh launches,
    /// which is what they were.
    #[serde(default)]
    pub handoff: bool,
    pub task_id: String,
    pub project_id: String,
    pub issue_type_id: String,
    pub state_id: String,
    #[serde(default)]
    pub state_name: Option<String>,
    pub prompt: String,
    pub required_skills: Vec<String>,
    #[serde(default)]
    pub entry_skill: Option<String>,
    pub provider: String,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub module_link: ModuleLinkInput,
}

#[derive(Debug)]
pub enum LaunchPolicyError {
    Rejected { code: &'static str, message: String },
    Database(DbErr),
}

impl LaunchPolicyError {
    pub fn rejected(code: &'static str, message: impl Into<String>) -> Self {
        Self::Rejected {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Rejected { code, .. } => code,
            Self::Database(_) => "launch_policy_storage_failed",
        }
    }
}

impl std::fmt::Display for LaunchPolicyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected { message, .. } => formatter.write_str(message),
            Self::Database(error) => write!(formatter, "Launch policy storage failed: {error}"),
        }
    }
}

impl std::error::Error for LaunchPolicyError {}

impl From<DbErr> for LaunchPolicyError {
    fn from(error: DbErr) -> Self {
        Self::Database(error)
    }
}
