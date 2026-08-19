//! The narrow filesystem-event port a watcher consumes.
//!
//! Operating-system notification is best-effort by nature: events arrive late,
//! arrive twice, coalesce, or are dropped entirely when a queue overflows. The
//! port therefore publishes *four* things rather than a stream of truths — a
//! touched path, a vanished path, an overflow, and a failure — and the last two
//! are first-class values instead of hidden errors, because a watcher that
//! silently swallowed them would be claiming the event stream was complete when
//! it was not.
//!
//! Keeping this a trait is what makes overflow and failure testable at all. No
//! test can make a real kernel queue overflow on demand, and a capability whose
//! only recovery path could not be exercised would be a recovery path in name.

use std::path::PathBuf;

use tokio::sync::mpsc;

/// One thing the operating system said about a watched directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FilesystemEvent {
    /// A path was created or written. Whether it is a document, and whether it
    /// still exists, is decided by the watcher rather than believed here.
    Touched(PathBuf),
    /// A path was removed or renamed away.
    Vanished(PathBuf),
    /// Notifications were dropped. What happened is unknown, so the only
    /// correct response is to re-read the filesystem.
    Overflowed,
    /// The watch itself failed. The stream is no longer a description of the
    /// directory, so — like overflow — the filesystem is re-read.
    Failed,
}

/// A live watch over one directory. Dropping it stops the watch.
pub trait DirectoryWatch: Send {
    /// The events observed since the last poll. `None` once the watch has ended.
    fn events(&mut self) -> &mut mpsc::UnboundedReceiver<FilesystemEvent>;
}

/// Starts watches. The supervisor holds one of these so a test can supply a
/// driveable stream without a real kernel watcher.
pub trait FilesystemWatcher: Send + Sync {
    /// Begin watching `root` recursively, or report that it cannot be watched.
    fn watch(&self, root: &std::path::Path) -> Result<Box<dyn DirectoryWatch>, WatchUnavailable>;
}

/// The one failure starting a watch can have. It carries no local path: a
/// watcher that cannot start falls back to rescanning, and the reason is a log
/// line rather than a published detail.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WatchUnavailable;

/// The shipping watcher, backed by the platform's notification API.
pub struct NotifyWatcher;

/// A watch whose events are delivered on a channel, and whose underlying
/// platform watcher lives exactly as long as the channel does.
struct ChannelWatch {
    receiver: mpsc::UnboundedReceiver<FilesystemEvent>,
    /// Held only to keep the platform watch alive; dropping it stops the watch.
    _watcher: Box<dyn std::any::Any + Send>,
}

impl DirectoryWatch for ChannelWatch {
    fn events(&mut self) -> &mut mpsc::UnboundedReceiver<FilesystemEvent> {
        &mut self.receiver
    }
}

impl FilesystemWatcher for NotifyWatcher {
    fn watch(&self, root: &std::path::Path) -> Result<Box<dyn DirectoryWatch>, WatchUnavailable> {
        use notify::{RecursiveMode, Watcher};

        let (sender, receiver) = mpsc::unbounded_channel();
        let mut watcher = notify::recommended_watcher(move |result| {
            for event in translate(result) {
                // A closed receiver means the watcher was stopped; the platform
                // watch is dropped moments later.
                let _ = sender.send(event);
            }
        })
        .map_err(|_| WatchUnavailable)?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|_| WatchUnavailable)?;
        Ok(Box::new(ChannelWatch {
            receiver,
            _watcher: Box::new(watcher),
        }))
    }
}

/// Narrow one platform notification into the port's vocabulary.
///
/// Anything that is not unambiguously a removal is a touch: a rename into the
/// directory, a metadata change, and an unclassified "something happened" all
/// mean the same thing to a watcher that re-reads the path anyway. A dropped
/// notification is reported as overflow rather than as a touch of nothing.
fn translate(result: notify::Result<notify::Event>) -> Vec<FilesystemEvent> {
    use notify::event::{EventKind, ModifyKind, RenameMode};

    let event = match result {
        Ok(event) => event,
        Err(error) => {
            return vec![if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
                FilesystemEvent::Overflowed
            } else {
                FilesystemEvent::Failed
            }]
        }
    };
    if matches!(event.kind, EventKind::Other) {
        // Platform backends report a dropped-notification rescan as `Other`.
        // Treating it as a touch of the affected paths would claim the stream
        // was complete, so it is an overflow.
        return vec![FilesystemEvent::Overflowed];
    }
    let removal = matches!(
        event.kind,
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From))
    );
    event
        .paths
        .into_iter()
        .map(|path| {
            if removal {
                FilesystemEvent::Vanished(path)
            } else {
                FilesystemEvent::Touched(path)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind, ModifyKind, RemoveKind, RenameMode};

    fn event(kind: EventKind, path: &str) -> notify::Result<notify::Event> {
        Ok(notify::Event {
            kind,
            paths: vec![PathBuf::from(path)],
            attrs: Default::default(),
        })
    }

    #[test]
    fn a_creation_and_a_write_are_both_touches() {
        assert_eq!(
            translate(event(EventKind::Create(CreateKind::File), "/root/SPEC.md")),
            vec![FilesystemEvent::Touched(PathBuf::from("/root/SPEC.md"))]
        );
        assert_eq!(
            translate(event(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
                "/root/SPEC.md"
            )),
            vec![FilesystemEvent::Touched(PathBuf::from("/root/SPEC.md"))]
        );
    }

    #[test]
    fn a_removal_and_a_rename_away_are_both_vanishings() {
        assert_eq!(
            translate(event(EventKind::Remove(RemoveKind::File), "/root/SPEC.md")),
            vec![FilesystemEvent::Vanished(PathBuf::from("/root/SPEC.md"))]
        );
        assert_eq!(
            translate(event(
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                "/root/SPEC.md"
            )),
            vec![FilesystemEvent::Vanished(PathBuf::from("/root/SPEC.md"))]
        );
    }

    #[test]
    fn a_dropped_notification_is_an_overflow_rather_than_a_touch() {
        assert_eq!(
            translate(event(EventKind::Other, "/root")),
            vec![FilesystemEvent::Overflowed]
        );
    }

    #[test]
    fn a_watch_error_ends_the_streams_claim_to_completeness() {
        assert_eq!(
            translate(Err(notify::Error::generic("the watch failed"))),
            vec![FilesystemEvent::Failed]
        );
    }
}
