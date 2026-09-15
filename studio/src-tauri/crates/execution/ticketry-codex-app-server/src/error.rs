use std::fmt;

#[derive(Debug)]
pub struct CodexAppServerError {
    message: String,
    transport: bool,
}

impl CodexAppServerError {
    /// Build an unavailable result from an alternate or scripted reader.
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            transport: false,
        }
    }

    pub(crate) fn transport(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            transport: true,
        }
    }

    pub(crate) fn protocol(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            transport: false,
        }
    }

    pub(crate) fn timeout(method: &str) -> Self {
        Self {
            message: format!("codex app-server {method} timed out after 5 seconds"),
            transport: true,
        }
    }

    pub(crate) fn is_transport(&self) -> bool {
        self.transport
    }
}

impl fmt::Display for CodexAppServerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CodexAppServerError {}
