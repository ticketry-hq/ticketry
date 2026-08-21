//! Studio chords, as seen by a native Terminal viewer.
//!
//! While a libghostty view is first responder the WebView receives no key
//! events, so a Studio keymap binding cannot fire from an engaged agent
//! terminal. The native view recognises the few chords that must survive that
//! state — including module-position navigation — and reports them here; this
//! sink forwards each one to the WebView,
//! where the existing binding remains the single owner of what the chord does.
//! A viewer stops reporting the moment Viewer detachment begins, so a late
//! chord from a replaced viewer cannot act for its replacement.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Event delivered to Studio for one recognised chord.
pub const NATIVE_CHORD_EVENT: &str = "native-terminal-chord";

/// The chords a native viewer keeps from the terminal. The discriminants match
/// `muxed_ghostty_chord_e` in `native/libghostty_host.h`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StudioChord {
    PanelToggle,
    Settings,
    ModulePosition(u8),
    BodyDisengage,
}

impl StudioChord {
    /// Reads one native chord code. `None` covers both "not a chord" and a
    /// code this build does not know, so an unrecognised report is ignored
    /// rather than acted on as the wrong chord.
    pub fn from_native(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::PanelToggle),
            2 => Some(Self::Settings),
            3..=12 => Some(Self::ModulePosition(code - 2)),
            13 => Some(Self::BodyDisengage),
            _ => None,
        }
    }

    /// The identifier Studio's chord bridge routes on.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PanelToggle => "panel-toggle",
            Self::Settings => "settings",
            Self::ModulePosition(1) => "module-position-1",
            Self::ModulePosition(2) => "module-position-2",
            Self::ModulePosition(3) => "module-position-3",
            Self::ModulePosition(4) => "module-position-4",
            Self::ModulePosition(5) => "module-position-5",
            Self::ModulePosition(6) => "module-position-6",
            Self::ModulePosition(7) => "module-position-7",
            Self::ModulePosition(8) => "module-position-8",
            Self::ModulePosition(9) => "module-position-9",
            Self::ModulePosition(10) => "module-position-10",
            Self::ModulePosition(_) => unreachable!("module positions are validated at the bridge"),
            Self::BodyDisengage => "body-disengage",
        }
    }
}

pub struct ChordSink {
    accepting: AtomicBool,
    notify: Box<dyn Fn(StudioChord) + Send + Sync>,
}

impl ChordSink {
    pub fn new(notify: impl Fn(StudioChord) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            accepting: AtomicBool::new(true),
            notify: Box::new(notify),
        })
    }

    /// Reports one recognised chord. Returns false when the viewer no longer
    /// accepts chords.
    pub fn report(&self, chord: StudioChord) -> bool {
        if !self.accepting.load(Ordering::Acquire) {
            return false;
        }
        (self.notify)(chord);
        true
    }

    /// Called as Viewer detachment begins, before the native view is freed.
    pub fn stop_accepting(&self) {
        self.accepting.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn a_recognised_chord_reaches_studio() {
        let (sender, requests) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = sender.send(chord);
        });

        assert!(sink.report(StudioChord::PanelToggle));

        assert_eq!(requests.try_recv(), Ok(StudioChord::PanelToggle));
    }

    #[test]
    fn each_chord_is_forwarded_under_its_own_identity() {
        let (sender, requests) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = sender.send(chord);
        });

        assert!(sink.report(StudioChord::Settings));

        assert_eq!(requests.try_recv(), Ok(StudioChord::Settings));
        assert_eq!(StudioChord::Settings.as_str(), "settings");
        assert_eq!(StudioChord::PanelToggle.as_str(), "panel-toggle");
        assert_eq!(StudioChord::ModulePosition(4).as_str(), "module-position-4");
        assert_eq!(StudioChord::BodyDisengage.as_str(), "body-disengage");
    }

    #[test]
    fn native_codes_map_to_the_header_contract() {
        assert_eq!(StudioChord::from_native(0), None);
        assert_eq!(StudioChord::from_native(1), Some(StudioChord::PanelToggle));
        assert_eq!(StudioChord::from_native(2), Some(StudioChord::Settings));
        assert_eq!(
            StudioChord::from_native(3),
            Some(StudioChord::ModulePosition(1))
        );
        assert_eq!(
            StudioChord::from_native(12),
            Some(StudioChord::ModulePosition(10))
        );
        assert_eq!(
            StudioChord::from_native(13),
            Some(StudioChord::BodyDisengage)
        );
        // A code this build does not know is not acted on as another chord.
        assert_eq!(StudioChord::from_native(14), None);
    }

    #[test]
    fn a_late_chord_after_detachment_begins_is_refused() {
        let (sender, requests) = mpsc::channel();
        let sink = ChordSink::new(move |chord| {
            let _ = sender.send(chord);
        });

        sink.stop_accepting();

        assert!(!sink.report(StudioChord::PanelToggle));
        assert!(requests.try_recv().is_err());
    }

    #[test]
    fn a_replaced_viewers_chord_cannot_act_for_its_replacement() {
        let (sender, requests) = mpsc::channel();
        let replaced_sender = sender.clone();
        let replaced = ChordSink::new(move |chord| {
            let _ = replaced_sender.send(chord);
        });
        let replacement = ChordSink::new(move |chord| {
            let _ = sender.send(chord);
        });

        replaced.stop_accepting();

        assert!(!replaced.report(StudioChord::Settings));
        assert!(requests.try_recv().is_err());
        assert!(replacement.report(StudioChord::Settings));
        assert_eq!(requests.try_recv(), Ok(StudioChord::Settings));
    }
}
