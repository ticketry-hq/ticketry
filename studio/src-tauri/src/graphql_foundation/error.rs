use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FoundationInitializationErrorCode {
    DatabaseDirectory,
    DatabaseOpen,
    Migration,
    Schema,
    EndpointInstall,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundationInitializationError {
    pub code: FoundationInitializationErrorCode,
    pub message: String,
}

impl FoundationInitializationError {
    pub(crate) fn new(code: FoundationInitializationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for FoundationInitializationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for FoundationInitializationError {}
