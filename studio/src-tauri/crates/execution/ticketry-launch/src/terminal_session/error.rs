use ticketry_runs::RunsPersistenceError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalLaunchErrorCode {
    InvalidRequest,
    UnusableFolder,
    Conflict,
    EffectBusy,
    RuntimeUnavailable,
    RuntimeStartFailed,
    RuntimeConflict,
    RuntimeExited,
    PromptDeliveryFailed,
    ResumeUnknown,
    ResumeActive,
    ResumeSessionless,
    ResumeAgentless,
    ResumeUnsupported,
    ResumeWrongScope,
    ResumeAlreadyResumed,
    Storage,
    InjectedStop,
}

#[derive(Debug)]
pub struct TerminalLaunchError {
    pub code: TerminalLaunchErrorCode,
    message: String,
}

impl TerminalLaunchError {
    pub fn new(code: TerminalLaunchErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    #[doc(hidden)]
    pub fn unusable_folder(message: impl Into<String>) -> Self {
        Self::new(TerminalLaunchErrorCode::UnusableFolder, message)
    }

    #[doc(hidden)]
    pub fn runtime_start_failed(message: impl Into<String>) -> Self {
        Self::new(TerminalLaunchErrorCode::RuntimeStartFailed, message)
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            TerminalLaunchErrorCode::InvalidRequest => "terminal_launch_invalid",
            TerminalLaunchErrorCode::UnusableFolder => "module_folder_unusable",
            TerminalLaunchErrorCode::Conflict => "terminal_launch_conflict",
            TerminalLaunchErrorCode::EffectBusy => "terminal_launch_busy",
            TerminalLaunchErrorCode::RuntimeUnavailable => "terminal_runtime_unavailable",
            TerminalLaunchErrorCode::RuntimeStartFailed => "terminal_runtime_start_failed",
            TerminalLaunchErrorCode::RuntimeConflict => "terminal_runtime_identity_conflict",
            TerminalLaunchErrorCode::RuntimeExited => "terminal_runtime_exited",
            TerminalLaunchErrorCode::PromptDeliveryFailed => "prompt_delivery_failed",
            TerminalLaunchErrorCode::ResumeUnknown => "resume_unknown",
            TerminalLaunchErrorCode::ResumeActive => "resume_active",
            TerminalLaunchErrorCode::ResumeSessionless => "resume_sessionless",
            TerminalLaunchErrorCode::ResumeAgentless => "resume_agentless",
            TerminalLaunchErrorCode::ResumeUnsupported => "resume_unsupported",
            TerminalLaunchErrorCode::ResumeWrongScope => "resume_wrong_scope",
            TerminalLaunchErrorCode::ResumeAlreadyResumed => "resume_already_resumed",
            TerminalLaunchErrorCode::Storage => "terminal_launch_storage_failed",
            TerminalLaunchErrorCode::InjectedStop => "terminal_launch_injected_stop",
        }
    }
}

impl From<RunsPersistenceError> for TerminalLaunchError {
    fn from(error: RunsPersistenceError) -> Self {
        use ticketry_runs::RunsPersistenceErrorCode;
        let code = match error.code() {
            RunsPersistenceErrorCode::LaunchConflict => TerminalLaunchErrorCode::Conflict,
            RunsPersistenceErrorCode::LaunchLeaseNotHeld => TerminalLaunchErrorCode::EffectBusy,
            RunsPersistenceErrorCode::Storage => TerminalLaunchErrorCode::Storage,
            _ => TerminalLaunchErrorCode::InvalidRequest,
        };
        Self::new(code, error.to_string())
    }
}

impl std::fmt::Display for TerminalLaunchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalLaunchError {}
