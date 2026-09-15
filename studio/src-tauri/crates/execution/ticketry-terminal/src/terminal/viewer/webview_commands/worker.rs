use super::super::attachment::AttachmentOutcome;
use super::super::worker_diagnostics;
use super::*;
use std::io::Read;
use std::sync::mpsc::{Receiver, RecvTimeoutError};

pub(super) fn spawn_viewer_worker(
    runtime: Arc<ViewerRuntime>,
    run_id: String,
    handle: String,
    viewer: TerminalAttachment,
    output: Channel<ViewerChannelEvent>,
    command_sender: mpsc::Sender<WorkerCommand>,
    command_receiver: Receiver<WorkerCommand>,
    output_observation: Option<OutputObservationTrigger>,
) {
    let (control, mut reader) = viewer.into_control_and_reader();
    let (output_sender, output_receiver) = mpsc::sync_channel(OUTPUT_CHANNEL_CAPACITY);
    spawn_output_pump(
        &run_id,
        &handle,
        output_receiver,
        output,
        command_sender.clone(),
    );

    let reader_sender = output_sender.clone();
    let reader_commands = command_sender.clone();
    let reader_run = run_id.clone();
    let reader_handle = handle.clone();
    worker_diagnostics::spawn("pty-reader", &run_id, &handle, move || {
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
        crate::terminal::diagnostics::record(
            "terminal-viewer-reader-closed",
            Some(&reader_run),
            serde_json::json!({
                "viewerHandle": reader_handle,
                "reason": format!("{close_reason:?}"),
            }),
        );
        let _ = reader_commands.send(WorkerCommand::ReaderClosed(close_reason));
    });

    let control_run = run_id.clone();
    let control_handle = handle.clone();
    let registry_handle = handle.clone();
    worker_diagnostics::spawn("control", &run_id, &handle, move || {
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
                    crate::terminal::diagnostics::record(
                        "terminal-viewer-control-closed",
                        Some(&control_run),
                        serde_json::json!({
                            "viewerHandle": control_handle,
                            "reason": format!("{reason:?}"),
                        }),
                    );
                    let status = close_viewer(&runtime, &registry_handle, reason);
                    let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                    let _ = reply.send(Ok(status));
                    return;
                }
                Ok(WorkerCommand::ReaderClosed(reason)) => {
                    if is_detaching(&runtime, &registry_handle) {
                        continue;
                    }
                    crate::terminal::diagnostics::record(
                        "terminal-viewer-control-closed",
                        Some(&control_run),
                        serde_json::json!({
                            "viewerHandle": control_handle,
                            "reason": format!("{reason:?}"),
                        }),
                    );
                    let status = close_viewer(&runtime, &registry_handle, reason);
                    let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                    let _ = status;
                    return;
                }
                Ok(WorkerCommand::ChannelClosed) => {
                    crate::terminal::diagnostics::record(
                        "terminal-viewer-control-closed",
                        Some(&control_run),
                        serde_json::json!({
                            "viewerHandle": control_handle,
                            "reason": "channel_closed",
                        }),
                    );
                    if let Some(control) = control.take() {
                        let _ = control.detach();
                    }
                    close_viewer(&runtime, &registry_handle, ViewerCloseReason::ChannelClosed);
                    return;
                }
                Err(RecvTimeoutError::Timeout) => match control
                    .as_mut()
                    .expect("attached viewer has control")
                    .poll_exit()
                {
                    Ok(Some(AttachmentOutcome::ClientExited { exit_code })) => {
                        let reason = ViewerCloseReason::TmuxClientExited { exit_code };
                        crate::terminal::diagnostics::record(
                            "terminal-viewer-control-closed",
                            Some(&control_run),
                            serde_json::json!({
                                "viewerHandle": control_handle,
                                "reason": "tmux_client_exited",
                                "exitCode": exit_code,
                            }),
                        );
                        close_viewer(&runtime, &registry_handle, reason);
                        let _ = output_sender.send(ViewerChannelEvent::Closed { reason });
                        return;
                    }
                    Ok(_) => {}
                    Err(_) => {
                        crate::terminal::diagnostics::record(
                            "terminal-viewer-control-closed",
                            Some(&control_run),
                            serde_json::json!({
                                "viewerHandle": control_handle,
                                "reason": "tmux_client_poll_failed",
                            }),
                        );
                        let _ = output_sender.send(ViewerChannelEvent::Failure {
                            layer: ViewerFailureLayer::Pty,
                            code: ViewerFailureCode::PtyFailed,
                            message: "could not poll the viewer PTY client".to_owned(),
                        });
                        close_viewer(&runtime, &registry_handle, ViewerCloseReason::PtyEof);
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
    run_id: &str,
    handle: &str,
    receiver: Receiver<ViewerChannelEvent>,
    output: Channel<ViewerChannelEvent>,
    command_sender: mpsc::Sender<WorkerCommand>,
) {
    let run = run_id.to_owned();
    let viewer_handle = handle.to_owned();
    worker_diagnostics::spawn("output-pump", run_id, handle, move || {
        while let Ok(event) = receiver.recv() {
            if output.send(event).is_err() {
                crate::terminal::diagnostics::record(
                    "terminal-viewer-output-channel-closed",
                    Some(&run),
                    serde_json::json!({"viewerHandle": viewer_handle}),
                );
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
