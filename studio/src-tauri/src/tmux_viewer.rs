//! The native, viewer-only attachment to a durable Muxed tmux session.
//!
//! tmux owns the durable session. This module owns only the transient PTY
//! client used by the desktop renderer, so detaching a viewer cannot kill an
//! agent run's session.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::env;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const DEFAULT_TMUX_SOCKET: &str = "muxed";
const TMUX_SOCKET_ENV: &str = "MUXED_TMUX_SOCKET";
const VIEWER_TERM: &str = "xterm-256color";
#[cfg(target_os = "macos")]
const VIEWER_TERMINFO: &str = "/usr/share/terminfo";
#[cfg(target_os = "macos")]
const VIEWER_LC_CTYPE: &str = "UTF-8";
#[cfg(not(target_os = "macos"))]
const VIEWER_LC_CTYPE: &str = "C.UTF-8";
const SESSION_PREFIX: &str = "pt-";
const MAX_COLUMNS: u16 = 500;
const MAX_ROWS: u16 = 500;
const MAX_SCROLL_LINES: u16 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TmuxScrollDirection {
    Up,
    Down,
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

/// A viewer PTY attached to exactly one application-derived tmux session.
pub struct TmuxViewer {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    client: Box<dyn Child + Send + Sync>,
    tmux: PathBuf,
    session: String,
}

/// The command surface's control half of an attached viewer. Keeping the
/// reader separate lets the output worker block under backpressure without
/// delaying input, resize, or an explicit detach.
pub struct TmuxViewerControl {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    client: Box<dyn Child + Send + Sync>,
    tmux: PathBuf,
    session: String,
}

impl TmuxViewer {
    /// Attach a transient PTY client to the durable session for `run_id`.
    ///
    /// The executable, socket, and session name are deliberately derived here;
    /// callers can provide none of them.
    pub fn attach(run_id: &str, columns: u16, rows: u16) -> Result<Self, TmuxViewerError> {
        validate_run_id(run_id)?;
        let size = pty_size(columns, rows)?;
        let tmux = approved_tmux_path()?;
        let session = session_name(run_id);

        if !session_exists(&tmux, &session)? {
            return Err(TmuxViewerError::SessionNotFound {
                run_id: run_id.to_owned(),
            });
        }
        resize_tmux_window(&tmux, &session, columns, rows)?;

        let pair = native_pty_system().openpty(size).map_err(pty_error)?;
        let reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;
        let socket = tmux_socket()?;
        let command = tmux_attach_command(&tmux, &socket, &session);
        let mut client = pair.slave.spawn_command(command).map_err(pty_error)?;

        // A session can disappear after the preflight check. Surface that race
        // as a recoverable ended-session error, rather than a stuck viewer.
        if !session_exists(&tmux, &session)? || client.try_wait().map_err(pty_error)?.is_some() {
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
            tmux,
            session,
        })
    }

    /// Read raw bytes from tmux. PTY EOF is distinct from a client exit or
    /// explicit detach.
    pub fn read(&mut self, buffer: &mut [u8]) -> Result<usize, ViewerReadError> {
        match self.reader.read(buffer) {
            Ok(0) => Err(ViewerReadError::Outcome(ViewerOutcome::PtyEof)),
            Ok(read) => Ok(read),
            Err(error) => Err(ViewerReadError::Pty(error)),
        }
    }

    /// Split the blocking output reader from the operations that must remain
    /// responsive while a webview is slow to consume output.
    pub fn into_control_and_reader(self) -> (TmuxViewerControl, Box<dyn Read + Send>) {
        (
            TmuxViewerControl {
                master: self.master,
                writer: self.writer,
                client: self.client,
                tmux: self.tmux,
                session: self.session,
            },
            self.reader,
        )
    }

    /// Send raw renderer input to the attached tmux client.
    pub fn write_all(&mut self, input: &[u8]) -> Result<(), TmuxViewerError> {
        self.writer.write_all(input).map_err(io_error)?;
        self.writer.flush().map_err(io_error)?;
        Ok(())
    }

    /// Resize both the viewer PTY and its application-derived tmux window.
    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), TmuxViewerError> {
        let size = pty_size(columns, rows)?;
        self.master.resize(size).map_err(pty_error)?;
        resize_tmux_window(&self.tmux, &self.session, columns, rows)
    }

    /// Move this viewer through tmux copy-mode history without exposing a
    /// command, executable, socket, or session target to the caller.
    pub fn scroll(
        &self,
        direction: TmuxScrollDirection,
        lines: u16,
    ) -> Result<(), TmuxViewerError> {
        scroll_tmux(&self.tmux, &self.session, direction, lines)
    }

    /// Report a spontaneous tmux client exit separately from PTY EOF.
    pub fn poll_client_exit(&mut self) -> Result<Option<ViewerOutcome>, TmuxViewerError> {
        Ok(self.client.try_wait().map_err(io_error)?.map(|status| {
            ViewerOutcome::TmuxClientExited {
                exit_code: status.exit_code(),
            }
        }))
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
        self.writer.write_all(input).map_err(io_error)?;
        self.writer.flush().map_err(io_error)?;
        Ok(())
    }

    pub fn resize(&self, columns: u16, rows: u16) -> Result<(), TmuxViewerError> {
        let size = pty_size(columns, rows)?;
        self.master.resize(size).map_err(pty_error)?;
        resize_tmux_window(&self.tmux, &self.session, columns, rows)
    }

    pub fn scroll(
        &self,
        direction: TmuxScrollDirection,
        lines: u16,
    ) -> Result<(), TmuxViewerError> {
        scroll_tmux(&self.tmux, &self.session, direction, lines)
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

/// A raw read can produce bytes, a terminal outcome, or an I/O failure.
#[derive(Debug)]
pub enum ViewerReadError {
    Outcome(ViewerOutcome),
    Pty(io::Error),
}

impl fmt::Display for ViewerReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Outcome(outcome) => write!(formatter, "viewer ended: {outcome:?}"),
            Self::Pty(error) => write!(formatter, "PTY read failed: {error}"),
        }
    }
}

impl std::error::Error for ViewerReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Pty(error) => Some(error),
            Self::Outcome(_) => None,
        }
    }
}

fn validate_run_id(run_id: &str) -> Result<(), TmuxViewerError> {
    let valid = !run_id.is_empty()
        && run_id.len() <= 128
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(TmuxViewerError::InvalidRunId)
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

fn session_name(run_id: &str) -> String {
    format!("{SESSION_PREFIX}{run_id}")
}

fn tmux_socket() -> Result<String, TmuxViewerError> {
    let socket = env::var(TMUX_SOCKET_ENV).unwrap_or_else(|_| DEFAULT_TMUX_SOCKET.to_owned());
    let valid = !socket.is_empty()
        && socket.len() <= 64
        && socket
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if valid {
        Ok(socket)
    } else {
        Err(TmuxViewerError::TmuxUnavailable(
            "desktop supplied an invalid tmux socket name".to_owned(),
        ))
    }
}

fn approved_tmux_path() -> Result<PathBuf, TmuxViewerError> {
    let diagnostic = crate::discovery::preflight_report()
        .tools
        .into_iter()
        .find(|tool| tool.tool == crate::discovery::SupportedTool::Tmux)
        .ok_or_else(|| {
            TmuxViewerError::TmuxUnavailable("tool discovery did not return tmux".into())
        })?;
    if diagnostic.health != crate::discovery::ToolHealth::Ready {
        return Err(TmuxViewerError::TmuxUnavailable(
            diagnostic
                .guidance
                .unwrap_or_else(|| "approved tmux executable was not found".to_owned()),
        ));
    }
    diagnostic
        .path
        .map(PathBuf::from)
        .ok_or_else(|| TmuxViewerError::TmuxUnavailable("approved tmux has no path".into()))
}

fn tmux_attach_command(tmux: &Path, socket: &str, session: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new(tmux);
    command.args(["-L", socket, "attach-session", "-t", session]);
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
    command
}

fn session_exists(tmux: &Path, session: &str) -> Result<bool, TmuxViewerError> {
    let socket = tmux_socket()?;
    let status = Command::new(tmux)
        .args(["-L", &socket, "has-session", "-t", session])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(io_error)?;
    Ok(status.success())
}

fn resize_tmux_window(
    tmux: &Path,
    session: &str,
    columns: u16,
    rows: u16,
) -> Result<(), TmuxViewerError> {
    let socket = tmux_socket()?;
    let output = Command::new(tmux)
        .args([
            "-L",
            &socket,
            "resize-window",
            "-t",
            session,
            "-x",
            &columns.to_string(),
            "-y",
            &rows.to_string(),
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(io_error)?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(TmuxViewerError::Pty(format!(
        "tmux resize-window failed for {columns}x{rows}: {message}"
    )))
}

fn scroll_tmux(
    tmux: &Path,
    session: &str,
    direction: TmuxScrollDirection,
    lines: u16,
) -> Result<(), TmuxViewerError> {
    if !(1..=MAX_SCROLL_LINES).contains(&lines) {
        return Err(TmuxViewerError::InvalidScrollLines { lines });
    }
    // Ticketry targets tmux 3.6+'s -H capability explicitly so the marker is
    // hidden per entry without changing users' tmux configuration.
    run_tmux_control(tmux, session, &["copy-mode", "-e", "-H", "-t", session])?;
    let action = match direction {
        TmuxScrollDirection::Up => "scroll-up",
        TmuxScrollDirection::Down => "scroll-down",
    };
    let lines = lines.to_string();
    run_tmux_control(
        tmux,
        session,
        &["send-keys", "-t", session, "-X", "-N", &lines, action],
    )
}

fn run_tmux_control(tmux: &Path, session: &str, arguments: &[&str]) -> Result<(), TmuxViewerError> {
    let socket = tmux_socket()?;
    let output = Command::new(tmux)
        .args(["-L", &socket])
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .map_err(io_error)?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(TmuxViewerError::Pty(format!(
        "tmux viewer control failed for {session}: {message}"
    )))
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
        assert!(validate_run_id("run-123_abc").is_ok());
        assert!(matches!(
            validate_run_id(""),
            Err(TmuxViewerError::InvalidRunId)
        ));
        assert!(matches!(
            validate_run_id("run; kill-server"),
            Err(TmuxViewerError::InvalidRunId)
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

    #[test]
    fn session_names_are_application_derived() {
        assert_eq!(session_name("run-123"), "pt-run-123");
    }

    #[test]
    fn viewer_uses_a_launch_method_independent_terminal_environment() {
        let command = tmux_attach_command(Path::new("/approved/tmux"), "muxed", "pt-run-123");

        assert_eq!(
            command.get_env("TERM"),
            Some(std::ffi::OsStr::new(VIEWER_TERM))
        );
        #[cfg(target_os = "macos")]
        assert_eq!(
            command.get_env("TERMINFO"),
            Some(std::ffi::OsStr::new(VIEWER_TERMINFO)),
        );
        #[cfg(not(target_os = "macos"))]
        assert_eq!(command.get_env("TERMINFO"), None);
        assert_eq!(command.get_env("TERMINFO_DIRS"), None);
        assert_eq!(command.get_env("LC_ALL"), None);
        assert_eq!(
            command.get_env("LC_CTYPE"),
            Some(std::ffi::OsStr::new(VIEWER_LC_CTYPE)),
        );
        assert_eq!(
            command.get_argv(),
            &[
                "/approved/tmux",
                "-L",
                "muxed",
                "attach-session",
                "-t",
                "pt-run-123",
            ]
            .map(std::ffi::OsString::from)
            .to_vec(),
        );
    }

    #[test]
    fn rejects_unbounded_scroll_line_counts() {
        let error = scroll_tmux(
            Path::new("/unused"),
            "pt-run-123",
            TmuxScrollDirection::Up,
            0,
        );
        assert!(matches!(
            error,
            Err(TmuxViewerError::InvalidScrollLines { lines: 0 })
        ));
    }
}
