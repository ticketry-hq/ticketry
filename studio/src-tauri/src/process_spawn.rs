//! Serializes desktop child creation with non-atomic descriptor setup.

use std::io;
use std::process::{Command, ExitStatus, Output};
use std::sync::{Mutex, MutexGuard};

static PROCESS_SPAWN_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn with_lock<T>(operation: impl FnOnce() -> T) -> T {
    let _guard = spawn_guard();
    operation()
}

pub(crate) fn status(command: &mut Command) -> io::Result<ExitStatus> {
    let mut child = with_lock(|| command.spawn())?;
    child.wait()
}

pub(crate) fn output(command: &mut Command) -> io::Result<Output> {
    let child = with_lock(|| command.spawn())?;
    child.wait_with_output()
}

fn spawn_guard() -> MutexGuard<'static, ()> {
    PROCESS_SPAWN_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn concurrent_spawn_sections_do_not_overlap() {
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first = thread::spawn(move || {
            with_lock(|| {
                first_entered_tx.send(()).expect("report first entry");
                release_first_rx.recv().expect("release first entry");
            });
        });
        first_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first section entered");

        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second = thread::spawn(move || {
            with_lock(|| second_entered_tx.send(()).expect("report second entry"));
        });
        assert!(
            second_entered_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "a second process spawn entered while descriptor setup held the lock"
        );

        release_first_tx.send(()).expect("release first section");
        second_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second section entered after release");
        first.join().expect("first section thread");
        second.join().expect("second section thread");
    }
}
