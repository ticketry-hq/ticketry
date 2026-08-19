//! Folding a burst of writes into one settlement per path.
//!
//! An agent streaming a document to disk produces a write event per chunk. Each
//! one names the same path, and only the last one describes the file anyone
//! will read. Settling every event would publish a document fact per chunk and
//! make a person's workspace flicker through half-written Markdown.
//!
//! The window is therefore per path rather than global: two documents written
//! at once are two settlements, while one document written ten times is one.
//! Folding is also *deferred* rather than dropped — the events inside a window
//! are collapsed into a single settlement that happens after the window, so the
//! last write is always the one that gets read. The Django watcher relayed the
//! first event of a burst and suppressed the rest; deferring instead is the one
//! deliberate strengthening, because relaying first meant registering a file at
//! the moment it was still empty.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

/// The established fold window. Long enough to absorb a streamed write, short
/// enough that a document appears while a person is still looking at the tab.
pub(super) const DEBOUNCE: Duration = Duration::from_millis(300);

/// Paths observed but not yet settled.
pub(super) struct PendingPaths {
    paths: BTreeSet<String>,
    /// When the oldest unsettled observation arrived.
    since: Option<Instant>,
    window: Duration,
}

impl PendingPaths {
    pub(super) fn new(window: Duration) -> Self {
        Self {
            paths: BTreeSet::new(),
            since: None,
            window,
        }
    }

    /// Observe one document path. Repeat observations inside the window fold
    /// into the settlement already scheduled.
    pub(super) fn observe(&mut self, rel_path: String, now: Instant) {
        self.paths.insert(rel_path);
        self.since.get_or_insert(now);
    }

    /// How long until the fold window closes, or `None` when nothing is
    /// pending. Zero means it is already due.
    pub(super) fn due_in(&self, now: Instant) -> Option<Duration> {
        let since = self.since?;
        Some(self.window.saturating_sub(now.saturating_duration_since(since)))
    }

    /// Take everything folded so far. The caller settles what it takes.
    pub(super) fn take(&mut self) -> BTreeSet<String> {
        self.since = None;
        std::mem::take(&mut self.paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_on_one_path_settles_once() {
        let start = Instant::now();
        let mut pending = PendingPaths::new(DEBOUNCE);
        for _ in 0..10 {
            pending.observe("SPEC.md".to_owned(), start);
        }

        assert_eq!(pending.take(), BTreeSet::from(["SPEC.md".to_owned()]));
    }

    #[test]
    fn two_documents_written_at_once_are_both_settled() {
        let start = Instant::now();
        let mut pending = PendingPaths::new(DEBOUNCE);
        pending.observe("SPEC.md".to_owned(), start);
        pending.observe("notes/PLAN.md".to_owned(), start);

        assert_eq!(
            pending.take(),
            BTreeSet::from(["SPEC.md".to_owned(), "notes/PLAN.md".to_owned()])
        );
    }

    #[test]
    fn the_window_is_measured_from_the_first_observation_of_a_burst() {
        let start = Instant::now();
        let mut pending = PendingPaths::new(DEBOUNCE);
        pending.observe("SPEC.md".to_owned(), start);
        // A later write in the same burst must not push the settlement out.
        pending.observe("SPEC.md".to_owned(), start + DEBOUNCE / 2);

        assert_eq!(pending.due_in(start + DEBOUNCE / 2), Some(DEBOUNCE / 2));
        assert_eq!(pending.due_in(start + DEBOUNCE * 2), Some(Duration::ZERO));
    }

    #[test]
    fn nothing_pending_is_never_due() {
        let mut pending = PendingPaths::new(DEBOUNCE);

        assert_eq!(pending.due_in(Instant::now()), None);
        pending.observe("SPEC.md".to_owned(), Instant::now());
        pending.take();
        assert_eq!(pending.due_in(Instant::now()), None);
    }
}
