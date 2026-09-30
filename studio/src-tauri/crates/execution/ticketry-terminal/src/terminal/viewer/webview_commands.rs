//! The webview-facing terminal command boundary.
//!
//! JavaScript supplies only a run id, an opaque handle, terminal geometry,
//! bounded raw input, and validated scroll direction/count. Runtime mechanics
//! remain behind the transport-independent attachment boundary.

mod protocol;
mod validation;
mod worker;

use super::attachment::TerminalAttachment;
use protocol::MAX_INPUT_BYTES;
pub use protocol::{
    ViewerChannelEvent, ViewerCloseReason, ViewerCommandError, ViewerFailureCode,
    ViewerFailureLayer, ViewerLifecycle, ViewerScrollDirection, ViewerStatus,
};
use rand::Rng;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use validation::{validate_dimensions, validate_handle, validate_run_id, validate_scroll_lines};

use crate::terminal::output_activity::TerminalOutputActivityService;
use crate::viewer_ownership::{
    CreateViewerLease, PreparedViewerMechanics, ViewerDetachReason, ViewerOwnershipService,
};

const OUTPUT_CHANNEL_CAPACITY: usize = 64;
const READ_BUFFER_BYTES: usize = 8 * 1024;

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
                crate::terminal::diagnostics::record(
                    "terminal-output-observation-failed",
                    Some(&agent_run_id),
                    serde_json::json!({"message": error.to_string()}),
                );
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
    worker::spawn_viewer_worker(
        runtime.clone(),
        run_id.clone(),
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
    crate::terminal::diagnostics::record(
        "terminal-viewer-attached",
        Some(&run_id),
        serde_json::json!({
            "viewerHandle": handle,
            "columns": columns,
            "rows": rows,
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

fn new_handle() -> String {
    format!("viewer-{:032x}", rand::thread_rng().gen::<u128>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;

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
            code: protocol::TmuxAttachFailureCode::SessionNotFound,
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
