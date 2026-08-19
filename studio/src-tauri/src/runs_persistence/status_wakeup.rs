//! Post-commit wake-up for durable status subscribers.
//!
//! A wake-up carries no history. It only tells a subscriber that the outbox
//! may have grown, and the subscriber then rereads rows above its own last
//! emitted cursor. Dropped, delayed, duplicated, and reordered wake-ups are
//! therefore all safe: the database remains the only ordering authority.

use tokio::sync::broadcast;

/// A lagged subscriber must not be starved of a reread, so the channel keeps a
/// small buffer and reports overflow instead of dropping the subscriber.
const WAKEUP_BUFFER: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Wakeup {
    /// At least one event committed since the last wake-up.
    Committed,
    /// The publisher is gone. Subsequent progress depends on the reread tick.
    Silent,
}

#[derive(Clone)]
pub struct StatusWakeup {
    sender: broadcast::Sender<()>,
}

impl Default for StatusWakeup {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusWakeup {
    pub fn new() -> Self {
        Self {
            sender: broadcast::channel(WAKEUP_BUFFER).0,
        }
    }

    /// Register interest before the snapshot read so a commit that lands during
    /// the handshake is buffered rather than lost.
    pub(crate) fn listen(&self) -> StatusWakeupListener {
        StatusWakeupListener {
            receiver: self.sender.subscribe(),
        }
    }

    /// Called only after the authoritative row and its event have committed.
    pub(crate) fn publish(&self) {
        let _ = self.sender.send(());
    }
}

pub(crate) struct StatusWakeupListener {
    receiver: broadcast::Receiver<()>,
}

impl StatusWakeupListener {
    pub(crate) async fn wait(&mut self) -> Wakeup {
        match self.receiver.recv().await {
            // Overflow means more commits happened than the buffer held. The
            // reread that follows covers all of them in cursor order.
            Ok(()) | Err(broadcast::error::RecvError::Lagged(_)) => Wakeup::Committed,
            Err(broadcast::error::RecvError::Closed) => Wakeup::Silent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_commit_during_the_handshake_is_buffered_for_a_registered_listener() {
        let wakeup = StatusWakeup::new();
        let mut listener = wakeup.listen();
        wakeup.publish();

        assert_eq!(listener.wait().await, Wakeup::Committed);
    }

    #[tokio::test]
    async fn overflowing_wakeups_still_ask_for_one_reread() {
        let wakeup = StatusWakeup::new();
        let mut listener = wakeup.listen();
        for _ in 0..(WAKEUP_BUFFER * 3) {
            wakeup.publish();
        }

        assert_eq!(listener.wait().await, Wakeup::Committed);
    }

    #[tokio::test]
    async fn a_dropped_publisher_reports_silence_rather_than_a_committed_fact() {
        let wakeup = StatusWakeup::new();
        let mut listener = wakeup.listen();
        drop(wakeup);

        assert_eq!(listener.wait().await, Wakeup::Silent);
    }
}
