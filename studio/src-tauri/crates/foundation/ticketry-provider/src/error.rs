#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderErrorCode {
    UnknownProvider,
    UnsupportedProfile,
    InvalidProfile,
    UnregisteredProfile,
    ProfileConflict,
    UnsupportedModel,
    UnsupportedEffort,
    InvalidResumeIdentity,
    InvalidLaunchInput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderError {
    pub code: ProviderErrorCode,
    pub message: String,
}

impl ProviderError {
    pub(crate) fn new(code: ProviderErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}
