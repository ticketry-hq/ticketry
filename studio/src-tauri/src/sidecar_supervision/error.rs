//! What a supervised launch can fail with.
//!
//! Every variant carries a `FailureKind` so a caller can tell an operator
//! problem from a crash without matching on message text.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    Migration,
    Bind,
    ReadinessTimeout,
    Authentication,
    Crash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorError {
    pub service: String,
    pub kind: FailureKind,
    pub message: String,
}

impl SupervisorError {
    pub(super) fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            service: "backend".to_owned(),
            kind,
            message: message.into(),
        }
    }

    pub(super) fn for_service(mut self, service: &str) -> Self {
        self.service = service.to_owned();
        self
    }
}

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for SupervisorError {}

pub(super) fn process_error(error: std::io::Error) -> SupervisorError {
    SupervisorError::new(
        FailureKind::Crash,
        format!("sidecar process error: {error}"),
    )
}

pub(super) fn teardown_error(error: std::io::Error) -> SupervisorError {
    SupervisorError::new(
        FailureKind::Crash,
        format!("could not stop the owned sidecar process group: {error}"),
    )
}
