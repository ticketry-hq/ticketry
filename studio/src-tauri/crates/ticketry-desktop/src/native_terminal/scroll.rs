//! Acceptance of native wheel gestures for one Terminal viewer.
//!
//! The native host reports a normalized gesture; this sink decides whether the
//! viewer that produced it is still allowed to move the Durable terminal
//! session, and queues an accepted gesture as an ordinary viewer command. A
//! viewer stops accepting gestures the moment Viewer detachment begins, so a
//! late callback from a replaced viewer cannot scroll its replacement.

use super::worker::NativeViewerCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use ticketry_terminal::TerminalScrollDirection;

/// Direction codes shared with the native host's scroll intent.
pub const SCROLL_DIRECTION_NONE: u8 = 0;
pub const SCROLL_DIRECTION_UP: u8 = 1;
pub const SCROLL_DIRECTION_DOWN: u8 = 2;

/// The browser Terminal viewer's per-gesture bound.
pub const MAX_NATIVE_SCROLL_LINES: u16 = 20;

pub struct ScrollGestureSink {
    accepting: AtomicBool,
    commands: Sender<NativeViewerCommand>,
}

impl ScrollGestureSink {
    pub fn new(commands: Sender<NativeViewerCommand>) -> Arc<Self> {
        Arc::new(Self {
            accepting: AtomicBool::new(true),
            commands,
        })
    }

    /// Queues one normalized gesture. Returns false when the gesture carries
    /// no vertical intent or the viewer no longer accepts gestures.
    pub fn accept(&self, direction: u8, lines: u16) -> bool {
        if !self.accepting.load(Ordering::Acquire) {
            return false;
        }
        let Some(direction) = scroll_direction(direction) else {
            return false;
        };
        if lines == 0 {
            return false;
        }
        let lines = lines.min(MAX_NATIVE_SCROLL_LINES);
        self.commands
            .send(NativeViewerCommand::Scroll(direction, lines))
            .is_ok()
    }

    /// Called as Viewer detachment begins, before the native view is freed.
    pub fn stop_accepting(&self) {
        self.accepting.store(false, Ordering::Release);
    }
}

fn scroll_direction(direction: u8) -> Option<TerminalScrollDirection> {
    match direction {
        SCROLL_DIRECTION_UP => Some(TerminalScrollDirection::Up),
        SCROLL_DIRECTION_DOWN => Some(TerminalScrollDirection::Down),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn vertical_gestures_become_bounded_scroll_commands() {
        let (sender, commands) = mpsc::channel();
        let sink = ScrollGestureSink::new(sender);

        assert!(sink.accept(SCROLL_DIRECTION_UP, 6));
        assert!(sink.accept(SCROLL_DIRECTION_DOWN, 400));

        assert_eq!(
            commands.recv().unwrap(),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 6)
        );
        assert_eq!(
            commands.recv().unwrap(),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Down, MAX_NATIVE_SCROLL_LINES)
        );
    }

    #[test]
    fn gestures_without_vertical_intent_produce_no_command() {
        let (sender, commands) = mpsc::channel();
        let sink = ScrollGestureSink::new(sender);

        assert!(!sink.accept(SCROLL_DIRECTION_NONE, 3));
        assert!(!sink.accept(SCROLL_DIRECTION_UP, 0));

        assert!(commands.try_recv().is_err());
    }

    #[test]
    fn a_late_gesture_after_detachment_begins_is_refused() {
        let (sender, commands) = mpsc::channel();
        let sink = ScrollGestureSink::new(sender);

        sink.stop_accepting();

        assert!(!sink.accept(SCROLL_DIRECTION_UP, 5));
        assert!(commands.try_recv().is_err());
    }

    #[test]
    fn a_replaced_viewers_gesture_cannot_reach_its_replacement() {
        let (replacement_sender, replacement_commands) = mpsc::channel();
        let replaced = ScrollGestureSink::new(replacement_sender.clone());
        let replacement = ScrollGestureSink::new(replacement_sender);

        replaced.stop_accepting();

        assert!(!replaced.accept(SCROLL_DIRECTION_UP, 5));
        assert!(replacement_commands.try_recv().is_err());
        assert!(replacement.accept(SCROLL_DIRECTION_UP, 5));
        assert_eq!(
            replacement_commands.recv().unwrap(),
            NativeViewerCommand::Scroll(TerminalScrollDirection::Up, 5)
        );
    }
}
