//! The webview-facing terminal command boundary.
//!
//! JavaScript supplies only a run id, an opaque handle, terminal geometry,
//! bounded raw input, and validated scroll direction/count. Runtime mechanics
//! remain behind the transport-independent attachment boundary.

use super::attachment::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentError, TerminalScrollDirection,
};
use rand::Rng;
use serde::{Serialize, Serializer};
use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;

use crate::terminal::output_activity::TerminalOutputActivityService;
use crate::viewer_ownership::{
    CreateViewerLease, PreparedViewerMechanics, ViewerDetachReason, ViewerOwnershipService,
};

const MAX_INPUT_BYTES: usize = 64 * 1024;
const OUTPUT_CHANNEL_CAPACITY: usize = 64;
const READ_BUFFER_BYTES: usize = 8 * 1024;
const MAX_SCROLL_LINES: u16 = 500;

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

pub struct ViewerCommandState(Arc<ViewerRuntime>);

impl ViewerCommandState {
    pub fn new() -> Self {
        Self(Arc::new(ViewerRuntime::default()))
    }
}

#[derive(Default)]
struct ViewerRuntime {
    registry: Mutex<ViewerRegistry>,
}

#[derive(Default)]
struct ViewerRegistry {
    viewers: HashMap<String, ViewerEntry>,
}

struct FallbackViewerMechanics {
    runtime: Arc<ViewerRuntime>,
    handle: String,
}

impl PreparedViewerMechanics for FallbackViewerMechanics {
    fn detach(&self, _reason: ViewerDetachReason) {
        if let Ok(sender) = begin_detach(&self.runtime, &self.handle) {
            let _ = request(&sender, WorkerCommand::Detach);
        }
    }
}

struct ViewerEntry {
    status: ViewerStatus,
    command_sender: Option<mpsc::Sender<WorkerCommand>>,
}

#[derive(Clone)]
struct OutputObservationTrigger {
    service: crate::terminal::output_activity::TerminalOutputActivityService,
    agent_run_id: String,
    runtime: tokio::runtime::Handle,
}

impl OutputObservationTrigger {
    fn note_output(&self) {
        let service = self.service.clone();
        let agent_run_id = self.agent_run_id.clone();
        self.runtime.spawn(async move {
            if let Err(error) = service.observe(&agent_run_id).await {
                eprintln!("Terminal output observation failed for {agent_run_id}: {error}");
            }
        });
    }
}

enum WorkerCommand {
    Input(Vec<u8>, mpsc::Sender<Result<(), ViewerCommandError>>),
    Resize(u16, u16, mpsc::Sender<Result<(), ViewerCommandError>>),
    Scroll(
        ViewerScrollDirection,
        u16,
        mpsc::Sender<Result<(), ViewerCommandError>>,
    ),
    Detach(mpsc::Sender<Result<ViewerStatus, ViewerCommandError>>),
    ReaderClosed(ViewerCloseReason),
    ChannelClosed,
}

/// Attachment prepares transport mechanics. The caller's following GraphQL
/// lease mutation atomically chooses the winner and detaches any old viewer.
///
/// The shell resolves `output_activity` and `ownership` from its launch
/// runtime and passes them in, so this stays a terminal operation.
pub fn viewer_attach(
    state: &ViewerCommandState,
    output_activity: Option<TerminalOutputActivityService>,
    ownership: ViewerOwnershipService,
    run_id: String,
    viewer_id: String,
    columns: u16,
    rows: u16,
    output: Channel<ViewerChannelEvent>,
) -> Result<ViewerStatus, ViewerCommandError> {
    validate_run_id(&run_id)?;
    validate_dimensions(columns, rows)?;

    let runtime = state.0.clone();
    let viewer = TerminalAttachment::attach(&run_id, columns, rows)?;
    let handle = new_handle();
    let status = ViewerStatus {
        viewer_handle: handle.clone(),
        run_id: run_id.clone(),
        lifecycle: ViewerLifecycle::Attached,
        close_reason: None,
    };
    let (command_sender, command_receiver) = mpsc::channel();
    {
        let mut registry = runtime
            .registry
            .lock()
            .expect("viewer registry lock poisoned");
        registry.viewers.insert(
            handle.clone(),
            ViewerEntry {
                status: status.clone(),
                command_sender: Some(command_sender.clone()),
            },
        );
    }
    spawn_viewer_worker(
        runtime.clone(),
        handle.clone(),
        viewer,
        output,
        command_sender,
        command_receiver,
        output_activity
            .zip(tokio::runtime::Handle::try_current().ok())
            .map(|(service, runtime)| OutputObservationTrigger {
                service,
                agent_run_id: run_id.clone(),
                runtime,
            }),
    );
    let lease = CreateViewerLease {
        agent_run_id: run_id,
        viewer_id,
        transport: "xterm".to_owned(),
    };
    if let Err(error) = ownership.stage_prepared(
        &lease,
        Arc::new(FallbackViewerMechanics {
            runtime,
            handle: handle.clone(),
        }),
    ) {
        if let Ok(sender) = begin_detach(&state.0, &handle) {
            let _ = request(&sender, WorkerCommand::Detach);
        }
        return Err(ViewerCommandError::Pty {
            message: error.to_string(),
        });
    }
    Ok(status)
}

pub fn viewer_input(
    state: &ViewerCommandState,
    viewer_handle: String,
    data: Vec<u8>,
) -> Result<(), ViewerCommandError> {
    if data.len() > MAX_INPUT_BYTES {
        return Err(ViewerCommandError::InputTooLarge {
            maximum: MAX_INPUT_BYTES,
        });
    }
    let sender = active_sender(&state.0, &viewer_handle)?;
    request(&sender, |reply| WorkerCommand::Input(data, reply))
}

pub fn viewer_resize(
    state: &ViewerCommandState,
    viewer_handle: String,
    columns: u16,
    rows: u16,
) -> Result<(), ViewerCommandError> {
    validate_dimensions(columns, rows)?;
    let sender = active_sender(&state.0, &viewer_handle)?;
    request(&sender, |reply| WorkerCommand::Resize(columns, rows, reply))
}

pub fn viewer_scroll(
    state: &ViewerCommandState,
    viewer_handle: String,
    direction: ViewerScrollDirection,
    lines: u16,
) -> Result<(), ViewerCommandError> {
    validate_scroll_lines(lines)?;
    let sender = active_sender(&state.0, &viewer_handle)?;
    request(&sender, |reply| {
        WorkerCommand::Scroll(direction, lines, reply)
    })
}

pub fn viewer_detach(
    state: &ViewerCommandState,
    viewer_handle: String,
) -> Result<ViewerStatus, ViewerCommandError> {
    let sender = begin_detach(&state.0, &viewer_handle)?;
    request(&sender, WorkerCommand::Detach)
}

pub fn viewer_status(
    state: &ViewerCommandState,
    viewer_handle: String,
) -> Result<ViewerStatus, ViewerCommandError> {
    validate_handle(&viewer_handle)?;
    state
        .0
        .registry
        .lock()
        .expect("viewer registry lock poisoned")
        .viewers
        .get(&viewer_handle)
        .map(|entry| entry.status.clone())
        .ok_or(ViewerCommandError::ViewerNotFound)
}

fn validate_run_id(run_id: &str) -> Result<(), ViewerCommandError> {
    let valid = !run_id.is_empty()
        && run_id.len() <= 128
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or(ViewerCommandError::InvalidRunId)
}

fn validate_dimensions(columns: u16, rows: u16) -> Result<(), ViewerCommandError> {
    ((1..=500).contains(&columns) && (1..=500).contains(&rows))
        .then_some(())
        .ok_or(ViewerCommandError::InvalidSize { columns, rows })
}

fn validate_scroll_lines(lines: u16) -> Result<(), ViewerCommandError> {
    (1..=MAX_SCROLL_LINES)
        .contains(&lines)
        .then_some(())
        .ok_or(ViewerCommandError::InvalidScrollLines { lines })
}

fn validate_handle(handle: &str) -> Result<(), ViewerCommandError> {
    let valid = handle.len() == 39
        && handle.starts_with("viewer-")
        && handle[7..].bytes().all(|byte| byte.is_ascii_hexdigit());
    valid
        .then_some(())
        .ok_or(ViewerCommandError::InvalidViewerHandle)
}

fn active_sender(
    runtime: &Arc<ViewerRuntime>,
    handle: &str,
) -> Result<mpsc::Sender<WorkerCommand>, ViewerCommandError> {
    validate_handle(handle)?;
    let registry = runtime
        .registry
        .lock()
        .expect("viewer registry lock poisoned");
    let entry = registry
        .viewers
        .get(handle)
        .ok_or(ViewerCommandError::ViewerNotFound)?;
    match (entry.status.lifecycle, entry.command_sender.as_ref()) {
        (ViewerLifecycle::Attached, Some(sender)) => Ok(sender.clone()),
        (_, _) => Err(ViewerCommandError::ViewerClosed {
            reason: entry
                .status
                .close_reason
                .unwrap_or(ViewerCloseReason::Detached),
        }),
    }
}

fn begin_detach(
    runtime: &Arc<ViewerRuntime>,
    handle: &str,
) -> Result<mpsc::Sender<WorkerCommand>, ViewerCommandError> {
    validate_handle(handle)?;
    let mut registry = runtime
        .registry
        .lock()
        .expect("viewer registry lock poisoned");
    let entry = registry
        .viewers
        .get_mut(handle)
        .ok_or(ViewerCommandError::ViewerNotFound)?;
    if entry.status.lifecycle != ViewerLifecycle::Attached {
        return Err(ViewerCommandError::ViewerClosed {
            reason: entry
                .status
                .close_reason
                .unwrap_or(ViewerCloseReason::Detached),
        });
    }
    entry.status.lifecycle = ViewerLifecycle::Detaching;
    entry
        .command_sender
        .clone()
        .ok_or(ViewerCommandError::CommandUnavailable)
}

fn request<T>(
    sender: &mpsc::Sender<WorkerCommand>,
    command: impl FnOnce(mpsc::Sender<Result<T, ViewerCommandError>>) -> WorkerCommand,
) -> Result<T, ViewerCommandError> {
    let (reply_sender, reply_receiver) = mpsc::channel();
    sender
        .send(command(reply_sender))
        .map_err(|_| ViewerCommandError::CommandUnavailable)?;
    reply_receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| ViewerCommandError::CommandUnavailable)?
}

fn spawn_viewer_worker(
    runtime: Arc<ViewerRuntime>,
    handle: String,
    viewer: TerminalAttachment,
    output: Channel<ViewerChannelEvent>,
    command_sender: mpsc::Sender<WorkerCommand>,
    command_receiver: Receiver<WorkerCommand>,
    output_observation: Option<OutputObservationTrigger>,
) {
    let (control, mut reader) = viewer.into_control_and_reader();
    let (output_sender, output_receiver) = mpsc::sync_channel(OUTPUT_CHANNEL_CAPACITY);
    spawn_output_pump(output_receiver, output, command_sender.clone());

    let reader_sender = output_sender.clone();
    let reader_commands = command_sender.clone();
    thread::spawn(move || {
        let mut buffer = vec![0; READ_BUFFER_BYTES];
        let close_reason = loop {
            match reader.read(&mut buffer) {
                Ok(0) => break ViewerCloseReason::PtyEof,
                Ok(read) => {
                    if let Some(observation) = &output_observation {
                        observation.note_output();
                    }
                    if reader_sender
                        .send(ViewerChannelEvent::Output {
                            data: buffer[..read].to_vec(),
                        })
                        .is_err()
                    {
                        break ViewerCloseReason::ChannelClosed;
                    }
                }
                Err(error) => {
                    let _ = reader_sender.send(ViewerChannelEvent::Failure {
                        layer: ViewerFailureLayer::Pty,
                        code: ViewerFailureCode::PtyFailed,
                        message: error.to_string(),
                    });
                    break ViewerCloseReason::PtyEof;
                }
            }
        };
        let _ = reader_commands.send(WorkerCommand::ReaderClosed(close_reason));
    });

    thread::spawn(move || {
        let mut control = Some(control);
        loop {
            match command_receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(WorkerCommand::Input(data, reply)) => {
                    let _ = reply.send(
                        control
                            .as_mut()
                            .expect("attached viewer has control")
                            .write_all(&data)
                            .map_err(Into::into),
                    );
                }
                Ok(WorkerCommand::Resize(columns, rows, reply)) => {
                    let _ = reply.send(
                        control
                            .as_ref()
                            .expect("attached viewer has control")
                            .resize(columns, rows)
                            .map_err(Into::into),
                    );
                }
                Ok(WorkerCommand::Scroll(direction, lines, reply)) => {
                    let _ = reply.send(
                        control
                            .as_ref()
                            .expect("attached viewer has control")
                            .scroll(direction.into(), lines)
                            .map_err(Into::into),
                    );
                }
                Ok(WorkerCommand::Detach(reply)) => {
                    let reason = match control
                        .take()
                        .expect("attached viewer has control")
                        .detach()
                    {
                        Ok(AttachmentOutcome::Detached) => ViewerCloseReason::Detached,
                        Ok(AttachmentOutcome::PtyEof) => ViewerCloseReason::PtyEof,
                        Ok(AttachmentOutcome::ClientExited { exit_code }) => {
                            ViewerCloseReason::TmuxClientExited { exit_code }
                        }
                        Err(error) => {
                            let _ = reply.send(Err(error.into()));
                            continue;
                        }
                    };
                    let status = close_viewer(&runtime, &handle, reason);
                    let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                    let _ = reply.send(Ok(status));
                    return;
                }
                Ok(WorkerCommand::ReaderClosed(reason)) => {
                    if is_detaching(&runtime, &handle) {
                        continue;
                    }
                    let status = close_viewer(&runtime, &handle, reason);
                    let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                    let _ = status;
                    return;
                }
                Ok(WorkerCommand::ChannelClosed) => {
                    if let Some(control) = control.take() {
                        let _ = control.detach();
                    }
                    close_viewer(&runtime, &handle, ViewerCloseReason::ChannelClosed);
                    return;
                }
                Err(RecvTimeoutError::Timeout) => match control
                    .as_mut()
                    .expect("attached viewer has control")
                    .poll_exit()
                {
                    Ok(Some(AttachmentOutcome::ClientExited { exit_code })) => {
                        let reason = ViewerCloseReason::TmuxClientExited { exit_code };
                        close_viewer(&runtime, &handle, reason);
                        let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                        return;
                    }
                    Ok(_) => {}
                    Err(_) => {
                        let _ = output_sender.send(ViewerChannelEvent::Failure {
                            layer: ViewerFailureLayer::Pty,
                            code: ViewerFailureCode::PtyFailed,
                            message: "could not poll the viewer PTY client".to_owned(),
                        });
                        close_viewer(&runtime, &handle, ViewerCloseReason::PtyEof);
                        let _ = output_sender.send(ViewerChannelEvent::Closed {
                            reason: ViewerCloseReason::PtyEof,
                        });
                        return;
                    }
                },
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    });
}

impl ViewerCommandState {
    /// Application exit and window close detach only transient viewer clients.
    /// tmux sessions are deliberately never signalled or killed here.
    pub fn detach_all(&self) {
        let senders = self
            .0
            .registry
            .lock()
            .expect("viewer registry lock poisoned")
            .viewers
            .values()
            .filter_map(|entry| entry.command_sender.clone())
            .collect::<Vec<_>>();
        for sender in senders {
            let _ = sender.send(WorkerCommand::ChannelClosed);
        }
    }
}

fn spawn_output_pump(
    receiver: Receiver<ViewerChannelEvent>,
    output: Channel<ViewerChannelEvent>,
    command_sender: mpsc::Sender<WorkerCommand>,
) {
    thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            if output.send(event).is_err() {
                let _ = command_sender.send(WorkerCommand::ChannelClosed);
                return;
            }
        }
    });
}

fn is_detaching(runtime: &Arc<ViewerRuntime>, handle: &str) -> bool {
    runtime
        .registry
        .lock()
        .expect("viewer registry lock poisoned")
        .viewers
        .get(handle)
        .is_some_and(|entry| entry.status.lifecycle == ViewerLifecycle::Detaching)
}

fn close_viewer(
    runtime: &Arc<ViewerRuntime>,
    handle: &str,
    reason: ViewerCloseReason,
) -> ViewerStatus {
    let mut registry = runtime
        .registry
        .lock()
        .expect("viewer registry lock poisoned");
    let entry = registry
        .viewers
        .get_mut(handle)
        .expect("worker viewer must remain registered");
    if entry.status.lifecycle == ViewerLifecycle::Closed {
        return entry.status.clone();
    }
    entry.status.lifecycle = ViewerLifecycle::Closed;
    entry.status.close_reason = Some(reason);
    entry.command_sender = None;
    let status = entry.status.clone();
    status
}

fn new_handle() -> String {
    format!("viewer-{:032x}", rand::thread_rng().gen::<u128>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_every_untrusted_run_id_shape_before_core_attachment() {
        for value in [
            "tmux -L attacker attach-session",
            "run; kill-server",
            "$(open /Applications/Terminal.app)",
            "run/name",
        ] {
            assert_eq!(
                validate_run_id(value),
                Err(ViewerCommandError::InvalidRunId)
            );
        }
        assert!(validate_run_id("approved-run_123").is_ok());
        // A syntactically valid id is still never accepted as a session target:
        // the core always prefixes it when deriving the only tmux session.
        assert!(validate_run_id("pt-approved-run").is_ok());
    }

    #[test]
    fn validates_dimensions_input_and_opaque_handles_at_the_boundary() {
        assert!(matches!(
            validate_dimensions(0, 24),
            Err(ViewerCommandError::InvalidSize { .. })
        ));
        assert!(validate_handle("viewer-tmux-socket").is_err());
        assert!(validate_handle("viewer-0123456789abcdef0123456789abcdef").is_ok());
        assert!(MAX_INPUT_BYTES < 1024 * 1024);
    }

    #[test]
    fn bounded_output_queue_backpressures_then_recovers() {
        let (sender, receiver): (mpsc::SyncSender<u8>, Receiver<u8>) = mpsc::sync_channel(2);
        sender.send(1).unwrap();
        sender.send(2).unwrap();
        assert!(matches!(
            sender.try_send(3),
            Err(mpsc::TrySendError::Full(3))
        ));
        assert_eq!(receiver.recv().unwrap(), 1);
        sender.send(3).unwrap();
        assert_eq!(receiver.recv().unwrap(), 2);
        assert_eq!(receiver.recv().unwrap(), 3);
    }

    #[test]
    fn scroll_requests_accept_only_direction_and_bounded_line_count() {
        assert_eq!(
            serde_json::from_str::<ViewerScrollDirection>("\"up\"").unwrap(),
            ViewerScrollDirection::Up
        );
        assert!(serde_json::from_str::<ViewerScrollDirection>("\"page_up\"").is_err());
        assert!(validate_scroll_lines(1).is_ok());
        assert!(validate_scroll_lines(500).is_ok());
        assert!(validate_scroll_lines(0).is_err());
        assert!(validate_scroll_lines(501).is_err());
    }

    #[test]
    fn attach_and_pty_failures_keep_their_layer_and_code_over_ipc() {
        let missing = serde_json::to_value(ViewerCommandError::TmuxAttach {
            code: TmuxAttachFailureCode::SessionNotFound,
            message: "missing".to_owned(),
        })
        .unwrap();
        assert_eq!(missing["code"], "session_not_found");
        assert_eq!(missing["layer"], "tmux_attach");

        let pty = serde_json::to_value(ViewerCommandError::Pty {
            message: "read failed".to_owned(),
        })
        .unwrap();
        assert_eq!(pty["code"], "pty_failed");
        assert_eq!(pty["layer"], "pty");
    }
}
