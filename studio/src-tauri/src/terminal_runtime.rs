//! Transport-independent attachment boundary for native terminal viewers.
//!
//! Renderer adapters receive raw terminal I/O and viewer controls from this
//! module. The tmux session name, executable, socket, attach client, and PTY
//! mechanics remain private to the implementation behind it.

use crate::tmux_viewer::{
    TmuxScrollDirection, TmuxViewer, TmuxViewerControl, TmuxViewerError, ViewerOutcome,
};
use std::fmt;
use std::io::Read;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalScrollDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentOutcome {
    Detached,
    PtyEof,
    ClientExited { exit_code: u32 },
}

#[derive(Debug)]
pub enum TerminalAttachmentError {
    InvalidRunId,
    InvalidSize { columns: u16, rows: u16 },
    InvalidScrollLines { lines: u16 },
    SessionNotFound { run_id: String },
    SessionEnded { run_id: String },
    RuntimeUnavailable(String),
    Pty(String),
}

impl fmt::Display for TerminalAttachmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRunId => write!(formatter, "agent run identifier is invalid"),
            Self::InvalidSize { columns, rows } => {
                write!(formatter, "terminal size {columns}x{rows} is invalid")
            }
            Self::InvalidScrollLines { lines } => {
                write!(formatter, "terminal scroll line count {lines} is invalid")
            }
            Self::SessionNotFound { run_id } => {
                write!(formatter, "terminal for agent run {run_id:?} was not found")
            }
            Self::SessionEnded { run_id } => {
                write!(
                    formatter,
                    "terminal for agent run {run_id:?} ended while attaching"
                )
            }
            Self::RuntimeUnavailable(message) => {
                write!(formatter, "terminal runtime is unavailable: {message}")
            }
            Self::Pty(message) => write!(formatter, "terminal attachment failed: {message}"),
        }
    }
}

impl std::error::Error for TerminalAttachmentError {}

impl From<TmuxViewerError> for TerminalAttachmentError {
    fn from(error: TmuxViewerError) -> Self {
        match error {
            TmuxViewerError::InvalidRunId => Self::InvalidRunId,
            TmuxViewerError::InvalidSize { columns, rows } => Self::InvalidSize { columns, rows },
            TmuxViewerError::InvalidScrollLines { lines } => Self::InvalidScrollLines { lines },
            TmuxViewerError::SessionNotFound { run_id } => Self::SessionNotFound { run_id },
            TmuxViewerError::SessionEnded { run_id } => Self::SessionEnded { run_id },
            TmuxViewerError::TmuxUnavailable(message) => Self::RuntimeUnavailable(message),
            TmuxViewerError::Pty(message) => Self::Pty(message),
        }
    }
}

impl From<TerminalScrollDirection> for TmuxScrollDirection {
    fn from(direction: TerminalScrollDirection) -> Self {
        match direction {
            TerminalScrollDirection::Up => Self::Up,
            TerminalScrollDirection::Down => Self::Down,
        }
    }
}

impl From<ViewerOutcome> for AttachmentOutcome {
    fn from(outcome: ViewerOutcome) -> Self {
        match outcome {
            ViewerOutcome::Detached => Self::Detached,
            ViewerOutcome::PtyEof => Self::PtyEof,
            ViewerOutcome::TmuxClientExited { exit_code } => Self::ClientExited { exit_code },
        }
    }
}

pub struct TerminalAttachment(TmuxViewer);

pub struct TerminalAttachmentControl(TmuxViewerControl);

impl TerminalAttachment {
    pub fn attach(
        agent_run_id: &str,
        columns: u16,
        rows: u16,
    ) -> Result<Self, TerminalAttachmentError> {
        TmuxViewer::attach(agent_run_id, columns, rows)
            .map(Self)
            .map_err(Into::into)
    }

    pub fn into_control_and_reader(self) -> (TerminalAttachmentControl, Box<dyn Read + Send>) {
        let (control, reader) = self.0.into_control_and_reader();
        (TerminalAttachmentControl(control), reader)
    }

    pub fn detach(self) -> Result<AttachmentOutcome, TerminalAttachmentError> {
        self.0.detach().map(Into::into).map_err(Into::into)
    }
}

impl TerminalAttachmentControl {
    pub fn write_all(&mut self, input: &[u8]) -> Result<(), TerminalAttachmentError> {
        self.0.write_all(input).map_err(Into::into)
    }

    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), TerminalAttachmentError> {
        self.0.resize(columns, rows).map_err(Into::into)
    }

    pub fn scroll(
        &self,
        direction: TerminalScrollDirection,
        lines: u16,
    ) -> Result<(), TerminalAttachmentError> {
        self.0.scroll(direction.into(), lines).map_err(Into::into)
    }

    pub fn poll_exit(&mut self) -> Result<Option<AttachmentOutcome>, TerminalAttachmentError> {
        self.0
            .poll_client_exit()
            .map(|outcome| outcome.map(Into::into))
            .map_err(Into::into)
    }

    pub fn detach(self) -> Result<AttachmentOutcome, TerminalAttachmentError> {
        self.0.detach().map(Into::into).map_err(Into::into)
    }
}
