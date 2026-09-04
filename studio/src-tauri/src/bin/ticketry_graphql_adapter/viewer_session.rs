//! The lifecycle of one attached browser terminal viewer.
//!
//! Starting from an already-validated [`TerminalAttachment`], this module
//! establishes the durable viewer lease, pumps terminal output to the socket
//! under a bounded queue, applies input/resize/scroll through one serialized,
//! order-preserving command worker against the same control surface the
//! native webview uses, renews the lease while the socket lives, and releases
//! exactly its own lease on every exit. Neither side may wedge the other:
//! output sends time out into `terminal_output_pressure` and command
//! acceptance times out into `terminal_input_pressure`. Detaching a viewer
//! never terminates the durable tmux session.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use serde::Deserialize;
use tokio::sync::mpsc;

use muxed_studio_lib::terminal_viewer::attachment::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentControl, TerminalScrollDirection,
};
use muxed_studio_lib::viewer_ownership::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerMechanics, UpdateViewerLease,
    ViewerDetachReason, ViewerOwnershipError, ViewerOwnershipService,
};

use super::terminal_ws::{
    finish_socket, validate_geometry, ServerFrame, SessionClose, MAX_INPUT_BYTES,
};

const TRANSPORT: &str = "xterm";
const READ_BUFFER_BYTES: usize = 8 * 1024;
const OUTPUT_QUEUE_CHUNKS: usize = 64;
/// A webview that stops reading stalls the PTY long before this expires.
const OUTPUT_SEND_TIMEOUT: Duration = Duration::from_secs(30);
/// Depth of the serialized input/resize/scroll queue ahead of the PTY.
const COMMAND_QUEUE_CAPACITY: usize = 128;
const COMMAND_ACCEPT_TIMEOUT: Duration = Duration::from_secs(5);
/// Detaching yields to an in-flight command briefly, then gives up rather
/// than wedging teardown behind a blocked PTY write.
const DETACH_LOCK_GRACE: Duration = Duration::from_secs(5);
const LEASE_RENEWAL_INTERVAL: Duration = Duration::from_secs(10);
const CLIENT_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const DEFAULT_SCROLL_LINES: u16 = 3;
const MAX_SCROLL_LINES: u16 = 500;

/// Viewer ids must satisfy the shared lease identity rules.
pub(crate) fn new_viewer_id() -> String {
    format!("ws-{}", uuid::Uuid::new_v4().simple())
}

/// The blocking control half of an attached viewer, shared between the
/// command worker, the exit poll, and lease-driven detach signals. `detach`
/// consumes the control, so it is held behind [`Option`] inside the mutex.
#[derive(Clone)]
struct LiveControl(Arc<Mutex<Option<TerminalAttachmentControl>>>);

impl LiveControl {
    fn with<R>(&self, operation: impl FnOnce(&mut TerminalAttachmentControl) -> R) -> Option<R> {
        self.0
            .lock()
            .expect("viewer control lock poisoned")
            .as_mut()
            .map(operation)
    }

    /// Take the control for detachment even if the command worker is momentarily
    /// mid-command — but never wait longer than [`DETACH_LOCK_GRACE`] behind a
    /// genuinely wedged PTY operation.
    fn take_within(&self, grace: Duration) -> Option<TerminalAttachmentControl> {
        let deadline = Instant::now() + grace;
        loop {
            if let Ok(mut guard) = self.0.try_lock() {
                return guard.take();
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    async fn detach_and_release(self) {
        tokio::task::spawn_blocking(move || match self.take_within(DETACH_LOCK_GRACE) {
            Some(control) => control.detach().is_ok(),
            None => false,
        })
        .await
        .expect("viewer detach task cannot panic");
    }
}

/// One ordered terminal control operation executed against the viewer PTY.
#[derive(Debug, PartialEq, Eq)]
enum ViewerCommand {
    Write(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
    },
    Scroll {
        direction: TerminalScrollDirection,
        lines: u16,
    },
}

#[derive(Debug, PartialEq, Eq)]
enum OutputEvent {
    Bytes(Vec<u8>),
    Eof,
    ReadFailed(String),
}

/// A single background consumer executes every command from one bounded
/// queue in arrival order, so keystrokes can never reorder around resizes.
struct CommandWorker {
    sender: mpsc::Sender<ViewerCommand>,
}

impl CommandWorker {
    fn start(control: LiveControl) -> (Self, mpsc::UnboundedReceiver<String>) {
        let (sender, mut receiver) = mpsc::channel::<ViewerCommand>(COMMAND_QUEUE_CAPACITY);
        let (failure_sender, failure_receiver) = mpsc::unbounded_channel::<String>();
        std::thread::spawn(move || {
            while let Some(command) = receiver.blocking_recv() {
                let result = match command {
                    ViewerCommand::Write(data) => control.with(|control| control.write_all(&data)),
                    ViewerCommand::Resize { cols, rows } => {
                        control.with(|control| control.resize(cols, rows))
                    }
                    ViewerCommand::Scroll { direction, lines } => {
                        control.with(|control| control.scroll(direction, lines))
                    }
                };
                match result {
                    Some(Ok(())) => {}
                    Some(Err(error)) => {
                        let _ = failure_sender.send(error.to_string());
                        return;
                    }
                    None => return,
                }
            }
        });
        (Self { sender }, failure_receiver)
    }

    /// Bounded acceptance: wait for queue room only briefly. A full queue past
    /// the timeout means the attached terminal stopped accepting input, and
    /// the caller must report pressure instead of wedging the socket task.
    async fn enqueue(&self, command: ViewerCommand, acceptance_timeout: Duration) -> bool {
        matches!(
            tokio::time::timeout(acceptance_timeout, self.sender.send(command)).await,
            Ok(Ok(()))
        )
    }
}

/// Lease-visible mechanics: when viewer ownership detaches this viewer (it was
/// replaced by another one), the session loop learns through `shutdown` and
/// performs the actual transient-client detach itself.
struct SessionMechanics {
    shutdown: mpsc::UnboundedSender<ViewerDetachReason>,
}

impl PreparedViewerMechanics for SessionMechanics {
    fn detach(&self, reason: ViewerDetachReason) {
        let _ = self.shutdown.send(reason);
        // Dropping the PTY client happens in LiveControl; ownership only needs
        // the transient viewer to end, never the durable tmux session.
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ControlFrame {
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "scroll")]
    Scroll {
        dir: ScrollDirectionWire,
        #[serde(default)]
        lines: Option<u16>,
    },
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ScrollDirectionWire {
    Up,
    Down,
}

impl From<ScrollDirectionWire> for TerminalScrollDirection {
    fn from(direction: ScrollDirectionWire) -> Self {
        match direction {
            ScrollDirectionWire::Up => Self::Up,
            ScrollDirectionWire::Down => Self::Down,
        }
    }
}

fn resolve_scroll_lines(lines: Option<u16>) -> Option<u16> {
    let lines = lines.unwrap_or(DEFAULT_SCROLL_LINES);
    (1..=MAX_SCROLL_LINES).contains(&lines).then_some(lines)
}

/// Turn one JSON control frame into zero or more ordered commands. Frames
/// that are not canonical shapes — wrong fields, out-of-range counts or
/// geometry — contribute nothing rather than half of something.
fn control_commands(raw: &str) -> Vec<ViewerCommand> {
    let Ok(frame) = serde_json::from_str::<ControlFrame>(raw) else {
        return Vec::new();
    };
    match frame {
        ControlFrame::Resize { cols, rows } if validate_geometry(cols, rows) => {
            vec![ViewerCommand::Resize { cols, rows }]
        }
        ControlFrame::Resize { .. } => Vec::new(),
        ControlFrame::Scroll { dir, lines } => resolve_scroll_lines(lines)
            .map(|lines| {
                vec![ViewerCommand::Scroll {
                    direction: dir.into(),
                    lines,
                }]
            })
            .unwrap_or_default(),
    }
}

pub(super) async fn start(
    ownership: ViewerOwnershipService,
    agent_run_id: String,
    attachment: TerminalAttachment,
    socket: WebSocket,
) -> SessionClose {
    start_inner(Some(ownership), agent_run_id, attachment, socket).await
}

/// App runs have no Agent Run or Terminal Session row by design, so their
/// single panel viewer attaches without the agent-viewer lease table.
pub(super) async fn start_unleased(
    agent_run_id: String,
    attachment: TerminalAttachment,
    socket: WebSocket,
) -> SessionClose {
    start_inner(None, agent_run_id, attachment, socket).await
}

async fn start_inner(
    ownership: Option<ViewerOwnershipService>,
    agent_run_id: String,
    attachment: TerminalAttachment,
    mut socket: WebSocket,
) -> SessionClose {
    let viewer_id = new_viewer_id();
    let (control_half, mut reader) = attachment.into_control_and_reader();
    let control = LiveControl(Arc::new(Mutex::new(Some(control_half))));

    let (output_sender, mut output_receiver) = mpsc::channel::<OutputEvent>(OUTPUT_QUEUE_CHUNKS);
    std::thread::spawn(move || {
        let mut buffer = vec![0u8; READ_BUFFER_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = output_sender.blocking_send(OutputEvent::Eof);
                    return;
                }
                Err(error) => {
                    let _ = output_sender.blocking_send(OutputEvent::ReadFailed(error.to_string()));
                    return;
                }
                Ok(read) => {
                    if output_sender
                        .blocking_send(OutputEvent::Bytes(buffer[..read].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
    });

    let (worker, mut command_failures) = CommandWorker::start(control.clone());
    let (shutdown_sender, mut shutdown_receiver) = mpsc::unbounded_channel::<ViewerDetachReason>();
    let mechanics: Arc<dyn PreparedViewerMechanics> = Arc::new(SessionMechanics {
        shutdown: shutdown_sender,
    });
    let _unleased_mechanics = ownership.is_none().then(|| Arc::clone(&mechanics));

    let lease_request = CreateViewerLease {
        agent_run_id: agent_run_id.clone(),
        viewer_id: viewer_id.clone(),
        transport: TRANSPORT.to_owned(),
    };
    let generation = if let Some(ownership) = ownership.as_ref() {
        let established = match ownership.stage_prepared(&lease_request, mechanics) {
            Ok(()) => ownership.create(lease_request.clone()).await,
            Err(error) => Err(error),
        };
        match established {
            Ok(model) => Some(model.generation),
            Err(error) => {
                // The service may have detached our staged mechanics already; drain
                // any queued signal before tearing down inline.
                while shutdown_receiver.try_recv().is_ok() {}
                let close = SessionClose::LeaseRejected(error.to_string());
                control.detach_and_release().await;
                return finish_socket(socket, close).await;
            }
        }
    } else {
        None
    };

    let ready = ServerFrame::Ready {
        session_id: viewer_id.clone(),
        agent_run_id: agent_run_id.clone(),
    };
    if socket.send(ready.to_message()).await.is_err() {
        release(
            ownership.as_ref(),
            &agent_run_id,
            &viewer_id,
            generation.as_deref(),
            &control,
        )
        .await;
        return SessionClose::TransportGone;
    }

    let mut renewal = tokio::time::interval(LEASE_RENEWAL_INTERVAL);
    renewal.tick().await;
    let mut exit_poll = tokio::time::interval(CLIENT_EXIT_POLL_INTERVAL);
    exit_poll.tick().await;

    let close = loop {
        tokio::select! {
            reason = shutdown_receiver.recv() => break match reason {
                Some(ViewerDetachReason::Replaced)
                | Some(ViewerDetachReason::AcquisitionFailed) => SessionClose::LeaseLost,
                Some(ViewerDetachReason::Released) | None => SessionClose::Normal("detached"),
            },
            output = output_receiver.recv() => match output {
                Some(OutputEvent::Bytes(bytes)) => match tokio::time::timeout(
                    OUTPUT_SEND_TIMEOUT,
                    socket.send(Message::Binary(bytes.into())),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => break SessionClose::TransportGone,
                    Err(_elapsed) => break SessionClose::OutputPressure,
                },
                Some(OutputEvent::Eof) | None => break SessionClose::Normal("terminal_closed"),
                Some(OutputEvent::ReadFailed(error)) => break SessionClose::AttachmentFailed(
                    format!("terminal output read failed: {error}"),
                ),
            },
            command_failure = command_failures.recv() => break SessionClose::AttachmentFailed(
                command_failure.unwrap_or_else(|| "terminal command worker stopped".to_owned()),
            ),
            _ = renewal.tick() => {
                if let (Some(ownership), Some(generation)) =
                    (ownership.as_ref(), generation.as_ref())
                {
                    let renewal = UpdateViewerLease {
                        agent_run_id: agent_run_id.clone(),
                        viewer_id: viewer_id.clone(),
                        generation: generation.clone(),
                    };
                    if ownership.update(renewal).await.is_err() {
                        break SessionClose::LeaseLost;
                    }
                }
            }
            _ = exit_poll.tick() => match poll_client_exit(control.clone()).await {
                Ok(Some(outcome)) => break client_outcome_close(outcome),
                Err(error) => break SessionClose::AttachmentFailed(error),
                Ok(None) => {}
            },
            message = socket.recv() => match message {
                Some(Ok(Message::Text(text))) => match deliver_text(&worker, &text).await {
                    Ok(()) => {}
                    Err(close) => break close,
                },
                Some(Ok(Message::Binary(data))) => {
                    if data.len() > MAX_INPUT_BYTES {
                        break SessionClose::InputTooLarge;
                    }
                    if worker.enqueue(
                        ViewerCommand::Write(data.to_vec()),
                        COMMAND_ACCEPT_TIMEOUT,
                    )
                    .await
                    {
                        continue;
                    }
                    break SessionClose::InputPressure;
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                    break SessionClose::TransportGone;
                }
                Some(Ok(_)) => {}
            },
        }
    };

    release(
        ownership.as_ref(),
        &agent_run_id,
        &viewer_id,
        generation.as_deref(),
        &control,
    )
    .await;
    finish_socket(socket, close).await
}

async fn poll_client_exit(control: LiveControl) -> Result<Option<AttachmentOutcome>, String> {
    tokio::task::spawn_blocking(move || control.with(|control| control.poll_exit()))
        .await
        .map_err(|error| format!("viewer exit poll task failed: {error}"))?
        .transpose()
        .map(|outcome| outcome.flatten())
        .map_err(|error| format!("could not poll the viewer PTY client: {error}"))
}

/// Queue every control frame's commands for the serialized worker. A queue
/// that stays full past the acceptance timeout reports input pressure instead
/// of blocking this socket task indefinitely.
async fn deliver_text(worker: &CommandWorker, raw: &str) -> Result<(), SessionClose> {
    for command in control_commands(raw) {
        if !worker.enqueue(command, COMMAND_ACCEPT_TIMEOUT).await {
            return Err(SessionClose::InputPressure);
        }
    }
    Ok(())
}

fn client_outcome_close(outcome: AttachmentOutcome) -> SessionClose {
    match outcome {
        AttachmentOutcome::Detached | AttachmentOutcome::ClientExited { .. } => {
            // A transient attach client ending says nothing about the durable
            // tmux session; report a normal viewer ending.
            SessionClose::Normal("detached")
        }
        AttachmentOutcome::PtyEof => SessionClose::Normal("terminal_closed"),
    }
}

/// Release the exact lease this viewer created and end only its transient
/// client. Both halves are idempotent, so every exit path can call them.
async fn release(
    ownership: Option<&ViewerOwnershipService>,
    agent_run_id: &str,
    viewer_id: &str,
    generation: Option<&str>,
    control: &LiveControl,
) {
    if let (Some(ownership), Some(generation)) = (ownership, generation) {
        let delete_request = DeleteViewerLease {
            agent_run_id: agent_run_id.to_owned(),
            viewer_id: viewer_id.to_owned(),
            generation: generation.to_owned(),
        };
        // A replaced or expired lease is an idempotent no-op here.
        let _: Result<Option<_>, ViewerOwnershipError> = ownership.delete(delete_request).await;
    }
    control.clone().detach_and_release().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_lines_default_to_three_within_the_bounded_range() {
        assert_eq!(resolve_scroll_lines(None), Some(DEFAULT_SCROLL_LINES));
        assert_eq!(resolve_scroll_lines(Some(1)), Some(1));
        assert_eq!(resolve_scroll_lines(Some(MAX_SCROLL_LINES)), Some(500));
        assert_eq!(resolve_scroll_lines(Some(0)), None);
        assert_eq!(resolve_scroll_lines(Some(501)), None);
    }

    #[test]
    fn control_frames_accept_only_canonical_shapes() {
        assert!(matches!(
            serde_json::from_str::<ControlFrame>(r#"{"type":"resize","cols":80,"rows":24}"#),
            Ok(ControlFrame::Resize { cols: 80, rows: 24 })
        ));
        assert!(serde_json::from_str::<ControlFrame>(r#"{"type":"resize"}"#).is_err());
        assert!(
            serde_json::from_str::<ControlFrame>(r#"{"type":"scroll","dir":"page_up"}"#).is_err()
        );
        assert!(
            serde_json::from_str::<ControlFrame>(r#"{"type":"spawn","mode":"attach"}"#).is_err()
        );
    }

    #[test]
    fn scroll_frames_honor_a_non_default_line_count() {
        assert_eq!(
            control_commands(r#"{"type":"scroll","dir":"down","lines":17}"#),
            vec![ViewerCommand::Scroll {
                direction: TerminalScrollDirection::Down,
                lines: 17,
            }],
            "the client's own line count, not the default, must reach tmux"
        );
        assert_eq!(
            control_commands(r#"{"type":"scroll","dir":"up"}"#),
            vec![ViewerCommand::Scroll {
                direction: TerminalScrollDirection::Up,
                lines: DEFAULT_SCROLL_LINES,
            }]
        );
    }

    #[test]
    fn invalid_counts_and_geometry_produce_no_commands() {
        assert!(control_commands(r#"{"type":"scroll","dir":"up","lines":0}"#).is_empty());
        assert!(control_commands(r#"{"type":"scroll","dir":"up","lines":501}"#).is_empty());
        assert!(control_commands(r#"{"type":"scroll","dir":"up","lines":-1}"#).is_empty());
        assert!(control_commands(r#"{"type":"resize","cols":0,"rows":24}"#).is_empty());
        assert!(control_commands(r#"{"type":"resize","cols":9e9,"rows":24}"#).is_empty());
        assert!(control_commands("not json").is_empty());
    }

    #[test]
    fn scroll_wire_directions_map_to_tmux_directions() {
        assert_eq!(
            TerminalScrollDirection::from(ScrollDirectionWire::Up),
            TerminalScrollDirection::Up
        );
        assert_eq!(
            TerminalScrollDirection::from(ScrollDirectionWire::Down),
            TerminalScrollDirection::Down
        );
    }

    #[tokio::test]
    async fn bounded_output_queue_backpressures_then_recovers() {
        let (sender, mut receiver) = mpsc::channel::<OutputEvent>(1);
        sender
            .try_send(OutputEvent::Bytes(vec![1]))
            .expect("empty queue accepts one chunk");
        assert!(matches!(
            sender.try_send(OutputEvent::Bytes(vec![2])),
            Err(mpsc::error::TrySendError::Full(_))
        ));
        assert_eq!(receiver.recv().await, Some(OutputEvent::Bytes(vec![1])));
        sender
            .try_send(OutputEvent::Bytes(vec![2]))
            .expect("queue accepts another chunk after drain");
    }

    #[tokio::test]
    async fn a_closed_command_queue_is_not_reported_as_accepted() {
        let (sender, receiver) = mpsc::channel::<ViewerCommand>(1);
        drop(receiver);
        let worker = CommandWorker { sender };

        assert!(
            !worker
                .enqueue(
                    ViewerCommand::Resize { cols: 80, rows: 24 },
                    Duration::from_millis(20),
                )
                .await
        );
    }

    #[tokio::test]
    async fn command_acceptance_times_out_into_pressure_instead_of_wedging() {
        // A full queue whose receiver never consumes never frees room, so
        // awaiting enqueue unguarded would hang forever — the exact failure
        // mode the acceptance timeout exists to prevent.
        let (sender, _receiver) = mpsc::channel::<ViewerCommand>(1);
        sender
            .try_send(ViewerCommand::Resize { cols: 80, rows: 24 })
            .expect("an empty queue accepts one command");
        let started = Instant::now();
        let delivered = tokio::time::timeout(
            Duration::from_millis(20),
            sender.send(ViewerCommand::Resize { cols: 80, rows: 24 }),
        )
        .await;
        assert!(delivered.is_err(), "a full queue must reject via timeout");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn serialized_command_queue_preserves_arrival_order() {
        let (sender, mut receiver) = mpsc::channel::<ViewerCommand>(8);
        for lines in [1u16, 2, 3] {
            sender
                .send(ViewerCommand::Scroll {
                    direction: TerminalScrollDirection::Down,
                    lines,
                })
                .await
                .expect("queue has room");
        }
        let drained = [
            receiver.recv().await,
            receiver.recv().await,
            receiver.recv().await,
        ];
        let lines_only: Vec<_> = drained
            .into_iter()
            .map(|command| match command {
                Some(ViewerCommand::Scroll { lines, .. }) => Some(lines),
                _ => None,
            })
            .collect();
        assert_eq!(lines_only, vec![Some(1), Some(2), Some(3)]);
    }

    #[test]
    fn viewer_ids_satisfy_lease_identity_rules() {
        let viewer_id = new_viewer_id();
        assert!(viewer_id.starts_with("ws-"));
        assert!(viewer_id.len() <= 128);
        assert!(viewer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')));
    }
}
