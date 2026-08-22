//! The native, viewer-only attachment to a durable Muxed tmux session.
//!
//! tmux owns the durable session. This module owns only the transient PTY
//! client used by the desktop renderer, so detaching a viewer cannot kill an
//! agent run's session.

use crate::tmux_adapter::{ScrollDirection, TmuxAdapter, TmuxAdapterError};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::fmt;
use std::io::{self, Read, Write};
const VIEWER_TERM: &str = "xterm-256color";
#[cfg(target_os = "macos")]
const VIEWER_TERMINFO: &str = "/usr/share/terminfo";
#[cfg(target_os = "macos")]
const VIEWER_LC_CTYPE: &str = "UTF-8";
#[cfg(not(target_os = "macos"))]
const VIEWER_LC_CTYPE: &str = "C.UTF-8";
const MAX_COLUMNS: u16 = 500;
const MAX_ROWS: u16 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TmuxScrollDirection {
    Up,
    Down,
}

impl From<TmuxScrollDirection> for ScrollDirection {
    fn from(value: TmuxScrollDirection) -> Self {
        match value {
            TmuxScrollDirection::Up => Self::Up,
            TmuxScrollDirection::Down => Self::Down,
        }
    }
}

/// A terminal ending that the caller must handle explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewerOutcome {
    /// The application intentionally detached this viewer.
    Detached,
    /// The PTY stream closed before an explicit detach.
    PtyEof,
    /// The short-lived tmux attach client exited. This says nothing about the
    /// durable tmux session's lifecycle.
    TmuxClientExited { exit_code: u32 },
}

/// Failures at the Rust attachment boundary.
#[derive(Debug)]
pub enum TmuxViewerError {
    InvalidRunId,
    InvalidSize {
        columns: u16,
        rows: u16,
    },
    InvalidScrollLines {
        lines: u16,
    },
    InputTooLarge {
        bytes: usize,
    },
    /// The named durable session did not exist before attachment began.
    SessionNotFound {
        run_id: String,
    },
    /// The session existed at validation time but ended while its client was
    /// being attached. This is deliberately distinct from a missing session.
    SessionEnded {
        run_id: String,
    },
    TmuxUnavailable(String),
    Pty(String),
}

impl fmt::Display for TmuxViewerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRunId => write!(formatter, "agent run identifier is invalid"),
            Self::InvalidSize { columns, rows } => {
                write!(formatter, "terminal size {columns}x{rows} is invalid")
            }
            Self::InvalidScrollLines { lines } => {
                write!(formatter, "terminal scroll line count {lines} is invalid")
            }
            Self::InputTooLarge { bytes } => {
                write!(
                    formatter,
                    "terminal input of {bytes} bytes exceeds the limit"
                )
            }
            Self::SessionNotFound { run_id } => {
                write!(
                    formatter,
                    "tmux session for agent run {run_id:?} was not found"
                )
            }
            Self::SessionEnded { run_id } => {
                write!(
                    formatter,
                    "tmux session for agent run {run_id:?} ended while attaching"
                )
            }
            Self::TmuxUnavailable(message) => write!(formatter, "tmux is unavailable: {message}"),
            Self::Pty(message) => write!(formatter, "PTY operation failed: {message}"),
        }
    }
}

impl std::error::Error for TmuxViewerError {}

impl From<TmuxAdapterError> for TmuxViewerError {
    fn from(error: TmuxAdapterError) -> Self {
        match error {
            TmuxAdapterError::InvalidIdentifier => Self::InvalidRunId,
            TmuxAdapterError::InvalidGeometry { columns, rows } => {
                Self::InvalidSize { columns, rows }
            }
            TmuxAdapterError::InvalidScrollLines { lines } => Self::InvalidScrollLines { lines },
            TmuxAdapterError::InputTooLarge { bytes } => Self::InputTooLarge { bytes },
            TmuxAdapterError::InvalidOperation | TmuxAdapterError::Unavailable(_) => {
                Self::TmuxUnavailable(error.to_string())
            }
        }
    }
}

/// A viewer PTY attached to exactly one application-derived tmux session.
pub struct TmuxViewer {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    client: Box<dyn Child + Send + Sync>,
    adapter: TmuxAdapter,
    run_id: String,
}

/// The command surface's control half of an attached viewer. Keeping the
/// reader separate lets the output worker block under backpressure without
/// delaying input, resize, or an explicit detach.
pub struct TmuxViewerControl {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    client: Box<dyn Child + Send + Sync>,
    adapter: TmuxAdapter,
    run_id: String,
}

/// A tmux client command for a terminal emulator that owns its own PTY.
///
/// libghostty launches this command directly, so this type owns only the
/// validated command and the out-of-band controls Ticketry still needs.
pub struct TmuxCommandViewer {
    command: String,
    adapter: TmuxAdapter,
    run_id: String,
}

pub struct TmuxCommandViewerControl {
    adapter: TmuxAdapter,
    run_id: String,
}

impl TmuxViewer {
    /// Attach a transient PTY client to the durable session for `run_id`.
    ///
    /// The executable, socket, and session name are deliberately derived here;
    /// callers can provide none of them.
    pub fn attach(run_id: &str, columns: u16, rows: u16) -> Result<Self, TmuxViewerError> {
        TmuxAdapter::validate_run_id(run_id)?;
        let size = pty_size(columns, rows)?;
        let adapter = TmuxAdapter::discover()?;

        if !adapter.session_exists(run_id)? {
            return Err(TmuxViewerError::SessionNotFound {
                run_id: run_id.to_owned(),
            });
        }
        adapter.resize(run_id, columns, rows)?;

        let pair = native_pty_system().openpty(size).map_err(pty_error)?;
        let reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;
        let mut command = adapter.attach_command(run_id);
        configure_viewer_environment(&mut command);
        let mut client = pair.slave.spawn_command(command).map_err(pty_error)?;

        // A session can disappear after the preflight check. Surface that race
        // as a recoverable ended-session error, rather than a stuck viewer.
        if !adapter.session_exists(run_id)? || client.try_wait().map_err(pty_error)?.is_some() {
            let _ = client.kill();
            let _ = client.wait();
            return Err(TmuxViewerError::SessionEnded {
                run_id: run_id.to_owned(),
            });
        }

        Ok(Self {
            master: pair.master,
            reader,
            writer,
            client,
            adapter,
            run_id: run_id.to_owned(),
        })
    }

    /// Split the blocking output reader from the operations that must remain
    /// responsive while a webview is slow to consume output.
    pub fn into_control_and_reader(self) -> (TmuxViewerControl, Box<dyn Read + Send>) {
        (
            TmuxViewerControl {
                master: self.master,
                writer: self.writer,
                client: self.client,
                adapter: self.adapter,
                run_id: self.run_id,
            },
            self.reader,
        )
    }

    /// End only this viewer's tmux client and PTY; it never kills the session.
    pub fn detach(mut self) -> Result<ViewerOutcome, TmuxViewerError> {
        if let Some(status) = self.client.try_wait().map_err(io_error)? {
            return Ok(ViewerOutcome::TmuxClientExited {
                exit_code: status.exit_code(),
            });
        }
        self.client.kill().map_err(io_error)?;
        let _ = self.client.wait().map_err(io_error)?;
        Ok(ViewerOutcome::Detached)
    }
}

impl TmuxViewerControl {
    pub fn write_all(&mut self, input: &[u8]) -> Result<(), TmuxViewerError> {
        TmuxAdapter::validate_input(input)?;
        self.writer.write_all(input).map_err(io_error)?;
        self.writer.flush().map_err(io_error)?;
        Ok(())
    }

    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), TmuxViewerError> {
        let size = pty_size(columns, rows)?;
        self.master.resize(size).map_err(pty_error)?;
        self.adapter
            .resize(&self.run_id, columns, rows)
            .map_err(Into::into)
    }

    pub fn scroll(
        &self,
        direction: TmuxScrollDirection,
        lines: u16,
    ) -> Result<(), TmuxViewerError> {
        self.adapter
            .scroll(&self.run_id, direction.into(), lines)
            .map_err(Into::into)
    }

    pub fn poll_client_exit(&mut self) -> Result<Option<ViewerOutcome>, TmuxViewerError> {
        Ok(self.client.try_wait().map_err(io_error)?.map(|status| {
            ViewerOutcome::TmuxClientExited {
                exit_code: status.exit_code(),
            }
        }))
    }

    pub fn detach(mut self) -> Result<ViewerOutcome, TmuxViewerError> {
        if let Some(status) = self.client.try_wait().map_err(io_error)? {
            return Ok(ViewerOutcome::TmuxClientExited {
                exit_code: status.exit_code(),
            });
        }
        self.client.kill().map_err(io_error)?;
        let _ = self.client.wait().map_err(io_error)?;
        Ok(ViewerOutcome::Detached)
    }
}

impl TmuxCommandViewer {
    pub fn prepare(run_id: &str) -> Result<Self, TmuxViewerError> {
        TmuxAdapter::validate_run_id(run_id)?;
        let adapter = TmuxAdapter::discover()?;
        if !adapter.session_exists(run_id)? {
            return Err(TmuxViewerError::SessionNotFound {
                run_id: run_id.to_owned(),
            });
        }
        let command = format!(
            "/usr/bin/env {}",
            adapter.attach_shell_command(run_id, &viewer_shell_environment())
        );
        Ok(Self {
            command,
            adapter,
            run_id: run_id.to_owned(),
        })
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    pub fn into_control(self) -> TmuxCommandViewerControl {
        TmuxCommandViewerControl {
            adapter: self.adapter,
            run_id: self.run_id,
        }
    }
}

impl TmuxCommandViewerControl {
    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), TmuxViewerError> {
        pty_size(columns, rows)?;
        self.adapter
            .resize(&self.run_id, columns, rows)
            .map_err(Into::into)
    }

    pub fn scroll(
        &self,
        direction: TmuxScrollDirection,
        lines: u16,
    ) -> Result<(), TmuxViewerError> {
        self.adapter
            .scroll(&self.run_id, direction.into(), lines)
            .map_err(Into::into)
    }

    pub fn detach(self) -> Result<ViewerOutcome, TmuxViewerError> {
        Ok(ViewerOutcome::Detached)
    }
}

fn pty_size(columns: u16, rows: u16) -> Result<PtySize, TmuxViewerError> {
    if columns == 0 || rows == 0 || columns > MAX_COLUMNS || rows > MAX_ROWS {
        return Err(TmuxViewerError::InvalidSize { columns, rows });
    }
    Ok(PtySize {
        rows,
        cols: columns,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn configure_viewer_environment(command: &mut CommandBuilder) {
    // Finder launches do not provide a terminal environment. Conversely, a
    // development shell can provide TERMINFO and locale overrides that are
    // inappropriate for this internal PTY. Without a UTF-8 character type,
    // tmux replaces Unicode cells with underscores before libghostty sees
    // them. Pin both protocol and encoding regardless of launch method or
    // libghostty initialization order.
    command.env("TERM", VIEWER_TERM);
    command.env_remove("LC_ALL");
    command.env("LC_CTYPE", VIEWER_LC_CTYPE);
    #[cfg(target_os = "macos")]
    command.env("TERMINFO", VIEWER_TERMINFO);
    #[cfg(not(target_os = "macos"))]
    command.env_remove("TERMINFO");
    command.env_remove("TERMINFO_DIRS");
}

fn viewer_shell_environment() -> Vec<String> {
    let mut environment = vec![
        "-u".to_owned(),
        "LC_ALL".to_owned(),
        format!("TERM={VIEWER_TERM}"),
        format!("LC_CTYPE={VIEWER_LC_CTYPE}"),
    ];
    #[cfg(target_os = "macos")]
    environment.push(format!("TERMINFO={VIEWER_TERMINFO}"));
    #[cfg(not(target_os = "macos"))]
    environment.extend([
        "-u".to_owned(),
        "TERMINFO".to_owned(),
        "-u".to_owned(),
        "TERMINFO_DIRS".to_owned(),
    ]);

    environment
}

fn io_error(error: io::Error) -> TmuxViewerError {
    TmuxViewerError::Pty(error.to_string())
}

fn pty_error(error: impl fmt::Display) -> TmuxViewerError {
    TmuxViewerError::Pty(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_run_identifiers_at_the_boundary() {
        assert!(TmuxAdapter::validate_run_id("run-123_abc").is_ok());
        assert!(matches!(
            TmuxAdapter::validate_run_id(""),
            Err(TmuxAdapterError::InvalidIdentifier)
        ));
        assert!(matches!(
            TmuxAdapter::validate_run_id("run; kill-server"),
            Err(TmuxAdapterError::InvalidIdentifier)
        ));
    }

    #[test]
    fn rejects_unsafe_terminal_sizes() {
        assert!(matches!(
            pty_size(0, 24),
            Err(TmuxViewerError::InvalidSize { .. })
        ));
        assert!(matches!(
            pty_size(80, 501),
            Err(TmuxViewerError::InvalidSize { .. })
        ));
    }
}
