use sea_orm::DbErr;
use serde::{Deserialize, Serialize};

pub const DECISION_VERSION: i32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerScope {
    Interactive,
    AutoStart,
    Subtree,
}

impl CallerScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::AutoStart => "auto_start",
            Self::Subtree => "subtree",
        }
    }

    pub fn unattended(self) -> bool {
        !matches!(self, Self::Interactive)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchPolicyRequest {
    pub task_id: String,
    pub destination_state_id: Option<String>,
    pub provider_override: Option<String>,
    pub caller_scope: CallerScope,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SelectedProfileInput {
    pub index: i32,
    pub name: String,
    pub workspace_slug: String,
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
    pub task_id: String,
    pub project_id: String,
    pub issue_type_id: String,
    pub state_id: String,
    pub prompt: String,
    pub required_skills: Vec<String>,
    pub provider: String,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub selected_profile: SelectedProfileInput,
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
