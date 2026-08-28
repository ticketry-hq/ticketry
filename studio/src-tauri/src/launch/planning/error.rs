use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchPlanningErrorCode {
    UnknownProvider,
    UnsupportedModel,
    UnsupportedReasoning,
    ResumeUnsupported,
    InvalidResumeIdentity,
    RequiredSkillUnavailable,
    ExecutableUnavailable,
    InvalidExecutionAuthority,
    UnsupportedVersion,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchPlanningError {
    pub code: LaunchPlanningErrorCode,
    pub message: String,
}

impl LaunchPlanningError {
    pub(crate) fn new(code: LaunchPlanningErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for LaunchPlanningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LaunchPlanningError {}
