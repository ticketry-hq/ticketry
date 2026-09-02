use std::fmt;
use std::time::Duration;

const DEFAULT_HANDOFF_READINESS_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromptDeliveryFailureReason {
    ReadinessMarkerMissing,
    ReadinessTimeout,
    InvalidMessage,
    SessionVerificationFailed,
    CaptureFailed,
    BufferCreationFailed,
    PasteFailed,
    VisibilityTimeout,
    SubmissionFailed,
}

impl PromptDeliveryFailureReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadinessMarkerMissing => "readiness_marker_missing",
            Self::ReadinessTimeout => "readiness_timeout",
            Self::InvalidMessage => "invalid_message",
            Self::SessionVerificationFailed => "session_verification_failed",
            Self::CaptureFailed => "capture_failed",
            Self::BufferCreationFailed => "buffer_creation_failed",
            Self::PasteFailed => "paste_failed",
            Self::VisibilityTimeout => "visibility_timeout",
            Self::SubmissionFailed => "submission_failed",
        }
    }
}

#[derive(Debug)]
pub struct PromptDeliveryError {
    reason: PromptDeliveryFailureReason,
    detail: String,
}

impl PromptDeliveryError {
    pub(super) fn new(reason: PromptDeliveryFailureReason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: detail.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        "prompt_delivery_failed"
    }

    pub fn reason(&self) -> PromptDeliveryFailureReason {
        self.reason
    }
}

impl fmt::Display for PromptDeliveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: {}: {}",
            self.code(),
            self.reason.as_str(),
            self.detail
        )
    }
}

impl std::error::Error for PromptDeliveryError {}

#[derive(Clone, Copy, Debug)]
pub struct DeliveryTimings {
    pub readiness_timeout: Duration,
    pub readiness_poll: Duration,
    pub visibility_timeout: Duration,
    pub visibility_poll: Duration,
    pub paste_settle: Duration,
    pub completion_settle: Duration,
}

impl Default for DeliveryTimings {
    fn default() -> Self {
        Self {
            readiness_timeout: Duration::from_secs(30),
            readiness_poll: Duration::from_millis(50),
            visibility_timeout: Duration::from_secs(2),
            visibility_poll: Duration::from_millis(10),
            paste_settle: Duration::from_millis(150),
            completion_settle: Duration::from_millis(50),
        }
    }
}

impl DeliveryTimings {
    /// A mid-turn agent can remain legitimately busy well beyond the
    /// fresh-launch readiness window. Callers may replace this deadline from
    /// runtime configuration without changing the other delivery timings.
    pub fn handoff(readiness_timeout: Option<Duration>) -> Self {
        Self {
            readiness_timeout: readiness_timeout.unwrap_or(DEFAULT_HANDOFF_READINESS_TIMEOUT),
            ..Self::default()
        }
    }
}
