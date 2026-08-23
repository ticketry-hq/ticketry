//! Why preflight could not reach a verdict.
//!
//! A defect is not an error: preflight found it, named it, and the report says
//! what to do about it. An error is preflight failing to look — an unreadable
//! database, an engine it cannot inspect in this binary, a source that
//! classification already refused. The distinction matters because a defect
//! produces an actionable refusal while an error produces a support path.

use serde::Serialize;

/// Why one preflight run could not produce a verdict.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreflightFailure {
    /// The installation could not be opened or read as one consistent view.
    UnreadableInstallation,
    /// Classification did not identify the source as adoptable at all, so
    /// there is nothing for semantic checks to describe.
    NotAdoptable,
    /// The engine's checks need a driver this binary does not carry.
    EngineNotInspectable,
}

/// A preflight failure, carrying an operator-safe explanation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreflightError {
    failure: PreflightFailure,
    detail: String,
}

impl PreflightError {
    pub(crate) fn new(failure: PreflightFailure, detail: impl Into<String>) -> Self {
        Self {
            failure,
            detail: detail.into(),
        }
    }

    /// The stable reason, for callers deciding what to offer the user.
    #[must_use]
    pub const fn failure(&self) -> PreflightFailure {
        self.failure
    }

    /// The explanation. It names schema and engine facts, never content.
    #[must_use]
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

impl std::fmt::Display for PreflightError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.failure, self.detail)
    }
}

impl std::error::Error for PreflightError {}
