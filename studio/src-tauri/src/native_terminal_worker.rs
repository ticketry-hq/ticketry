//! Serialized command loop for one native Terminal viewer.
//!
//! Resize, scroll, process exit, and detach for a single viewer are ordered
//! through one channel and applied to its direct tmux controls. Keyboard and
//! mouse input stay entirely inside libghostty's PTY.

use crate::terminal_runtime::{
    AttachmentOutcome, TerminalAttachmentError, TerminalCommandAttachmentControl,
    TerminalScrollDirection,
};
use std::sync::mpsc::Receiver;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeViewerCommand {
    Resize(u16, u16),
    Scroll(TerminalScrollDirection, u16),
    AttachmentExited,
    Detach,
}

/// Why the viewer's command loop stopped. The caller owns the user-visible
/// reporting and registry cleanup for each outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeWorkerExit {
    Detached,
    AttachmentExited,
    ResizeFailed(String),
    CommandsDisconnected,
}

/// The viewer controls the command loop needs. Implemented by the real
/// terminal attachment and by test doubles that record the calls.
pub trait NativeViewerControl {
    fn resize(&self, columns: u16, rows: u16) -> Result<(), TerminalAttachmentError>;
    fn scroll(
        &self,
        direction: TerminalScrollDirection,
        lines: u16,
    ) -> Result<(), TerminalAttachmentError>;
    fn detach(self) -> Result<AttachmentOutcome, TerminalAttachmentError>;
}

impl NativeViewerControl for TerminalCommandAttachmentControl {
    fn resize(&self, columns: u16, rows: u16) -> Result<(), TerminalAttachmentError> {
        TerminalCommandAttachmentControl::resize(self, columns, rows)
    }

    fn scroll(
        &self,
        direction: TerminalScrollDirection,
        lines: u16,
    ) -> Result<(), TerminalAttachmentError> {
        TerminalCommandAttachmentControl::scroll(self, direction, lines)
    }

    fn detach(self) -> Result<AttachmentOutcome, TerminalAttachmentError> {
        TerminalCommandAttachmentControl::detach(self)
    }
}

/// Applies queued viewer commands in arrival order until the viewer detaches,
/// its direct child exits, or its command channel closes.
pub fn run_native_worker<C: NativeViewerControl>(
    control: C,
    commands: &Receiver<NativeViewerCommand>,
) -> NativeWorkerExit {
    let mut control = Some(control);
    loop {
        match commands.recv() {
            Ok(NativeViewerCommand::Resize(columns, rows)) => {
                if let Some(viewer) = control.as_ref() {
                    if let Err(error) = viewer.resize(columns, rows) {
                        let reason = error.to_string();
                        if let Some(viewer) = control.take() {
                            let _ = viewer.detach();
                        }
                        return NativeWorkerExit::ResizeFailed(reason);
                    }
                }
            }
            Ok(NativeViewerCommand::Scroll(direction, lines)) => {
                if let Some(viewer) = control.as_ref() {
                    let _ = viewer.scroll(direction, lines);
                }
            }
            Ok(NativeViewerCommand::AttachmentExited) => {
                control.take();
                return NativeWorkerExit::AttachmentExited;
            }
            Ok(NativeViewerCommand::Detach) => {
                if let Some(viewer) = control.take() {
                    let _ = viewer.detach();
                }
                return NativeWorkerExit::Detached;
            }
            Err(_) => return NativeWorkerExit::CommandsDisconnected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, PartialEq, Eq)]
    enum ControlCall {
        Resize(u16, u16),
        Scroll(TerminalScrollDirection, u16),
        Detach,
    }

    struct RecordingControl {
        calls: Arc<Mutex<Vec<ControlCall>>>,
        resize_error: Option<(u16, u16)>,
    }

    impl RecordingControl {
        fn new() -> (Self, Arc<Mutex<Vec<ControlCall>>>) {
            let calls = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    calls: Arc::clone(&calls),
                    resize_error: None,
                },
                calls,
            )
        }

        fn failing_resize(columns: u16, rows: u16) -> (Self, Arc<Mutex<Vec<ControlCall>>>) {
            let (mut control, calls) = Self::new();
            control.resize_error = Some((columns, rows));
            (control, calls)
        }

        fn record(&self, call: ControlCall) {
            self.calls.lock().expect("recorded calls").push(call);
        }
    }

    impl NativeViewerControl for RecordingControl {
        fn resize(&self, columns: u16, rows: u16) -> Result<(), TerminalAttachmentError> {
            self.record(ControlCall::Resize(columns, rows));
            if self.resize_error == Some((columns, rows)) {
                return Err(TerminalAttachmentError::Pty(
                    "tmux resize-window failed".to_owned(),
                ));
            }
            Ok(())
        }

        fn scroll(
            &self,
            direction: TerminalScrollDirection,
            lines: u16,
        ) -> Result<(), TerminalAttachmentError> {
            self.record(ControlCall::Scroll(direction, lines));
            Ok(())
        }

        fn detach(self) -> Result<AttachmentOutcome, TerminalAttachmentError> {
            self.record(ControlCall::Detach);
            Ok(AttachmentOutcome::Detached)
        }
    }

    #[test]
    fn scroll_uses_the_scroll_control() {
        let (control, calls) = RecordingControl::new();
        let (sender, commands) = mpsc::channel();
        sender
            .send(NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 6))
            .unwrap();
        sender
            .send(NativeViewerCommand::Scroll(
                TerminalScrollDirection::Down,
                20,
            ))
            .unwrap();
        sender.send(NativeViewerCommand::Detach).unwrap();

        assert_eq!(
            run_native_worker(control, &commands),
            NativeWorkerExit::Detached
        );
        let calls = calls.lock().expect("recorded calls");
        assert_eq!(
            *calls,
            vec![
                ControlCall::Scroll(TerminalScrollDirection::Up, 6),
                ControlCall::Scroll(TerminalScrollDirection::Down, 20),
                ControlCall::Detach,
            ]
        );
    }

    #[test]
    fn gestures_keep_their_order_alongside_resize() {
        let (control, calls) = RecordingControl::new();
        let (sender, commands) = mpsc::channel();
        for command in [
            NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 3),
            NativeViewerCommand::Resize(120, 40),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 1),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Down, 20),
            NativeViewerCommand::Detach,
        ] {
            sender.send(command).unwrap();
        }

        run_native_worker(control, &commands);

        assert_eq!(
            *calls.lock().expect("recorded calls"),
            vec![
                ControlCall::Scroll(TerminalScrollDirection::Up, 3),
                ControlCall::Resize(120, 40),
                ControlCall::Scroll(TerminalScrollDirection::Up, 1),
                ControlCall::Scroll(TerminalScrollDirection::Down, 20),
                ControlCall::Detach,
            ]
        );
    }

    #[test]
    fn commands_after_detach_cannot_reach_the_attachment() {
        let (control, calls) = RecordingControl::new();
        let (sender, commands) = mpsc::channel();
        sender.send(NativeViewerCommand::Detach).unwrap();
        sender
            .send(NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 4))
            .unwrap();

        run_native_worker(control, &commands);

        assert_eq!(
            *calls.lock().expect("recorded calls"),
            vec![ControlCall::Detach]
        );
    }

    #[test]
    fn resize_failure_detaches_and_stops_the_worker_with_the_reason() {
        let (control, calls) = RecordingControl::failing_resize(132, 41);
        let (sender, commands) = mpsc::channel();
        sender.send(NativeViewerCommand::Resize(132, 41)).unwrap();
        sender
            .send(NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 4))
            .unwrap();

        assert_eq!(
            run_native_worker(control, &commands),
            NativeWorkerExit::ResizeFailed(
                "terminal attachment failed: tmux resize-window failed".to_owned(),
            )
        );
        assert_eq!(
            *calls.lock().expect("recorded calls"),
            vec![ControlCall::Resize(132, 41), ControlCall::Detach]
        );
    }

    #[test]
    fn an_exited_attachment_stops_the_loop_without_detaching_again() {
        let (control, calls) = RecordingControl::new();
        let (sender, commands) = mpsc::channel();
        sender.send(NativeViewerCommand::AttachmentExited).unwrap();

        assert_eq!(
            run_native_worker(control, &commands),
            NativeWorkerExit::AttachmentExited
        );
        assert!(calls.lock().expect("recorded calls").is_empty());
    }
}
