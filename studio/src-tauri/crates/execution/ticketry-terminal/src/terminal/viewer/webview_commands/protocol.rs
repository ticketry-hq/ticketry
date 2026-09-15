use super::super::attachment::{TerminalAttachmentError, TerminalScrollDirection};
use serde::{Serialize, Serializer};

pub(super) const MAX_INPUT_BYTES: usize = 64 * 1024;

/// Events sent to the xterm adapter over Tauri's IPC channel.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewerChannelEvent {
    Output {
        data: Vec<u8>,
    },
    Failure {
        layer: ViewerFailureLayer,
        code: ViewerFailureCode,
        message: String,
    },
    Closed {
        reason: ViewerCloseReason,
    },
}

/// A named boundary in the desktop viewer pipeline. This crosses IPC intact so
/// a support report does not need to infer a failure source from prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerFailureLayer {
    Pty,
    TmuxAttach,
    Channel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerFailureCode {
    PtyFailed,
    ChannelClosed,
}

/// A viewer ending is never interpreted as the durable tmux session ending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewerCloseReason {
    Detached,
    PtyEof,
    TmuxClientExited { exit_code: u32 },
    ChannelClosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerLifecycle {
    Attached,
    Detaching,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerStatus {
    pub viewer_handle: String,
    pub run_id: String,
    pub lifecycle: ViewerLifecycle,
    pub close_reason: Option<ViewerCloseReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerScrollDirection {
    Up,
    Down,
}

impl From<ViewerScrollDirection> for TerminalScrollDirection {
    fn from(direction: ViewerScrollDirection) -> Self {
        match direction {
            ViewerScrollDirection::Up => Self::Up,
            ViewerScrollDirection::Down => Self::Down,
        }
    }
}

/// Stable, structured errors returned across the Tauri boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewerCommandError {
    InvalidRunId,
    InvalidSize {
        columns: u16,
        rows: u16,
    },
    InputTooLarge {
        maximum: usize,
    },
    InvalidScrollLines {
        lines: u16,
    },
    InvalidViewerHandle,
    ViewerNotFound,
    ViewerClosed {
        reason: ViewerCloseReason,
    },
    DuplicateAttach {
        run_id: String,
    },
    CommandUnavailable,
    TmuxAttach {
        code: TmuxAttachFailureCode,
        message: String,
    },
    Pty {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TmuxAttachFailureCode {
    SessionNotFound,
    SessionEnded,
    TmuxUnavailable,
}

impl Serialize for ViewerCommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "snake_case")]
        enum Code {
            InvalidRunId,
            InvalidSize,
            InputTooLarge,
            InvalidScrollLines,
            InvalidViewerHandle,
            ViewerNotFound,
            ViewerClosed,
            DuplicateAttach,
            CommandUnavailable,
            SessionNotFound,
            SessionEnded,
            TmuxUnavailable,
            PtyFailed,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire<'a> {
            code: Code,
            #[serde(skip_serializing_if = "Option::is_none")]
            layer: Option<ViewerFailureLayer>,
            message: &'a str,
        }
        let (code, layer, message) = match self {
            Self::InvalidRunId => (
                Code::InvalidRunId,
                Some(ViewerFailureLayer::TmuxAttach),
                "agent run identifier is invalid",
            ),
            Self::InvalidSize { .. } => (
                Code::InvalidSize,
                Some(ViewerFailureLayer::Pty),
                "terminal dimensions are invalid",
            ),
            Self::InputTooLarge { .. } => (
                Code::InputTooLarge,
                None,
                "terminal input exceeds the limit",
            ),
            Self::InvalidScrollLines { .. } => (
                Code::InvalidScrollLines,
                None,
                "terminal scroll line count is invalid",
            ),
            Self::InvalidViewerHandle => {
                (Code::InvalidViewerHandle, None, "viewer handle is invalid")
            }
            Self::ViewerNotFound => (Code::ViewerNotFound, None, "viewer handle was not found"),
            Self::ViewerClosed { .. } => (Code::ViewerClosed, None, "viewer is already closed"),
            Self::DuplicateAttach { .. } => (
                Code::DuplicateAttach,
                Some(ViewerFailureLayer::TmuxAttach),
                "a viewer is already attached to this run",
            ),
            Self::CommandUnavailable => (
                Code::CommandUnavailable,
                Some(ViewerFailureLayer::Channel),
                "viewer worker is unavailable",
            ),
            Self::TmuxAttach { code, message } => (
                match code {
                    TmuxAttachFailureCode::SessionNotFound => Code::SessionNotFound,
                    TmuxAttachFailureCode::SessionEnded => Code::SessionEnded,
                    TmuxAttachFailureCode::TmuxUnavailable => Code::TmuxUnavailable,
                },
                Some(ViewerFailureLayer::TmuxAttach),
                message.as_str(),
            ),
            Self::Pty { message } => (
                Code::PtyFailed,
                Some(ViewerFailureLayer::Pty),
                message.as_str(),
            ),
        };
        Wire {
            code,
            layer,
            message,
        }
        .serialize(serializer)
    }
}

impl From<TerminalAttachmentError> for ViewerCommandError {
    fn from(error: TerminalAttachmentError) -> Self {
        match error {
            TerminalAttachmentError::InvalidRunId => Self::InvalidRunId,
            TerminalAttachmentError::InvalidSize { columns, rows } => {
                Self::InvalidSize { columns, rows }
            }
            TerminalAttachmentError::InvalidScrollLines { lines } => {
                Self::InvalidScrollLines { lines }
            }
            TerminalAttachmentError::InputTooLarge { .. } => Self::InputTooLarge {
                maximum: MAX_INPUT_BYTES,
            },
            TerminalAttachmentError::SessionNotFound { .. } => Self::TmuxAttach {
                code: TmuxAttachFailureCode::SessionNotFound,
                message: error.to_string(),
            },
            TerminalAttachmentError::SessionEnded { .. } => Self::TmuxAttach {
                code: TmuxAttachFailureCode::SessionEnded,
                message: error.to_string(),
            },
            TerminalAttachmentError::RuntimeUnavailable(_) => Self::TmuxAttach {
                code: TmuxAttachFailureCode::TmuxUnavailable,
                message: error.to_string(),
            },
            TerminalAttachmentError::Pty(_) => Self::Pty {
                message: error.to_string(),
            },
        }
    }
}
