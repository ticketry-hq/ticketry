//! Private desktop-owner liveness channel for one packaged backend launch.
//!
//! Both pipe ends are close-on-exec in the desktop. Immediately before the
//! backend exec, only the read end has that flag cleared. The desktop copy of
//! the reader is released as soon as spawning returns, while the sole writer
//! moves into the corresponding owned-sidecar handle.

#[cfg(unix)]
mod platform {
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    #[cfg(not(any(
        target_os = "android",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "linux",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    use crate::process_spawn;

    const ARGUMENT: &str = "--owner-fd";

    #[derive(Debug)]
    pub(crate) struct OwnerLivenessWriter {
        _descriptor: OwnedFd,
    }

    #[derive(Debug)]
    pub(crate) struct PendingOwnerLiveness {
        reader: OwnedFd,
        writer: OwnerLivenessWriter,
    }

    impl PendingOwnerLiveness {
        pub(crate) fn prepare(command: &mut Command) -> io::Result<Self> {
            let (reader, writer) = cloexec_pipe()?;
            let reader_fd = reader.as_raw_fd();
            command.arg(ARGUMENT).arg(reader_fd.to_string());

            // SAFETY: this closure only changes one inherited descriptor flag.
            // The descriptor remains owned by `self` until spawn completes.
            unsafe {
                command.pre_exec(move || set_close_on_exec(reader_fd, false));
            }

            Ok(Self {
                reader,
                writer: OwnerLivenessWriter {
                    _descriptor: writer,
                },
            })
        }

        pub(crate) fn transfer_complete(self) -> OwnerLivenessWriter {
            let Self { reader, writer } = self;
            drop(reader);
            writer
        }

        #[cfg(test)]
        fn descriptors(&self) -> (RawFd, RawFd) {
            (self.reader.as_raw_fd(), self.writer._descriptor.as_raw_fd())
        }
    }

    #[cfg(any(
        target_os = "android",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "linux",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    fn cloexec_pipe() -> io::Result<(OwnedFd, OwnedFd)> {
        let mut descriptors = [-1; 2];
        let outcome = unsafe { libc::pipe2(descriptors.as_mut_ptr(), libc::O_CLOEXEC) };
        if outcome == -1 {
            return Err(io::Error::last_os_error());
        }

        // SAFETY: a successful pipe call returned two newly owned descriptors.
        let reader = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
        let writer = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
        Ok((reader, writer))
    }

    #[cfg(not(any(
        target_os = "android",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "linux",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn cloexec_pipe() -> io::Result<(OwnedFd, OwnedFd)> {
        process_spawn::with_lock(|| {
            let mut descriptors = [-1; 2];
            let outcome = unsafe { libc::pipe(descriptors.as_mut_ptr()) };
            if outcome == -1 {
                return Err(io::Error::last_os_error());
            }

            // SAFETY: a successful pipe call returned two newly owned descriptors.
            let reader = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
            let writer = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
            set_close_on_exec(reader.as_raw_fd(), true)?;
            set_close_on_exec(writer.as_raw_fd(), true)?;
            Ok((reader, writer))
        })
    }

    fn set_close_on_exec(descriptor: RawFd, enabled: bool) -> io::Result<()> {
        let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
        if flags == -1 {
            return Err(io::Error::last_os_error());
        }
        let updated = if enabled {
            flags | libc::FD_CLOEXEC
        } else {
            flags & !libc::FD_CLOEXEC
        };
        if unsafe { libc::fcntl(descriptor, libc::F_SETFD, updated) } == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::io::Read;
        use std::process::Stdio;
        use std::sync::Mutex;
        #[cfg(not(any(
            target_os = "android",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "linux",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        use std::{sync::mpsc, thread, time::Duration};

        static FD_TEST_LOCK: Mutex<()> = Mutex::new(());

        #[cfg(not(any(
            target_os = "android",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "linux",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        #[test]
        fn fallback_pipe_setup_waits_for_an_active_spawn_section() {
            let _guard = FD_TEST_LOCK.lock().expect("descriptor test lock");
            let (spawn_entered_tx, spawn_entered_rx) = mpsc::channel();
            let (release_spawn_tx, release_spawn_rx) = mpsc::channel();
            let active_spawn = thread::spawn(move || {
                crate::process_spawn::with_lock(|| {
                    spawn_entered_tx.send(()).expect("report spawn entry");
                    release_spawn_rx.recv().expect("release spawn entry");
                });
            });
            spawn_entered_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("spawn section entered");

            let (pipe_ready_tx, pipe_ready_rx) = mpsc::channel();
            let pipe_setup = thread::spawn(move || {
                let mut command = Command::new("/bin/true");
                let pending =
                    PendingOwnerLiveness::prepare(&mut command).expect("prepare fallback pipe");
                pipe_ready_tx.send(()).expect("report pipe setup");
                drop(pending);
            });
            assert!(
                pipe_ready_rx
                    .recv_timeout(Duration::from_millis(50))
                    .is_err(),
                "fallback pipe setup overlapped a process spawn"
            );

            release_spawn_tx.send(()).expect("release spawn section");
            pipe_ready_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("pipe setup completed after spawn");
            active_spawn.join().expect("spawn section thread");
            pipe_setup.join().expect("pipe setup thread");
        }

        #[test]
        fn each_preparation_owns_a_distinct_cloexec_pipe() {
            let _guard = FD_TEST_LOCK.lock().expect("descriptor test lock");
            let mut first_command = Command::new("/bin/true");
            let first = PendingOwnerLiveness::prepare(&mut first_command).expect("first pipe");
            let mut second_command = Command::new("/bin/true");
            let second = PendingOwnerLiveness::prepare(&mut second_command).expect("second pipe");

            let (first_reader, first_writer) = first.descriptors();
            let (second_reader, second_writer) = second.descriptors();
            assert_ne!(first_reader, second_reader);
            assert_ne!(first_writer, second_writer);
            for descriptor in [first_reader, first_writer, second_reader, second_writer] {
                let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
                assert_ne!(flags, -1, "descriptor is valid");
                assert_ne!(flags & libc::FD_CLOEXEC, 0, "desktop descriptor is private");
            }
        }

        #[test]
        fn pending_and_transferred_handles_close_with_their_owners() {
            let _guard = FD_TEST_LOCK.lock().expect("descriptor test lock");
            let mut pending_command = Command::new("/bin/true");
            let pending =
                PendingOwnerLiveness::prepare(&mut pending_command).expect("pending pipe");
            let pending_descriptors = pending.descriptors();
            drop(pending);
            for descriptor in [pending_descriptors.0, pending_descriptors.1] {
                assert_eq!(unsafe { libc::fcntl(descriptor, libc::F_GETFD) }, -1);
            }

            let mut transferred_command = Command::new("/bin/true");
            let transferred =
                PendingOwnerLiveness::prepare(&mut transferred_command).expect("transferred pipe");
            let (reader, writer) = transferred.descriptors();
            let writer_owner = transferred.transfer_complete();
            assert_eq!(unsafe { libc::fcntl(reader, libc::F_GETFD) }, -1);
            assert_ne!(unsafe { libc::fcntl(writer, libc::F_GETFD) }, -1);
            drop(writer_owner);
            assert_eq!(unsafe { libc::fcntl(writer, libc::F_GETFD) }, -1);
        }

        #[test]
        fn liveness_writer_emits_no_data_and_signals_only_by_closing() {
            let _guard = FD_TEST_LOCK.lock().expect("descriptor test lock");
            let mut command = Command::new("/bin/true");
            let pending = PendingOwnerLiveness::prepare(&mut command).expect("prepare pipe");
            let observer = pending.reader.try_clone().expect("clone pipe reader");
            let writer = pending.transfer_complete();

            let flags = unsafe { libc::fcntl(observer.as_raw_fd(), libc::F_GETFL) };
            assert_ne!(flags, -1, "read descriptor flags are available");
            assert_ne!(
                unsafe {
                    libc::fcntl(
                        observer.as_raw_fd(),
                        libc::F_SETFL,
                        flags | libc::O_NONBLOCK,
                    )
                },
                -1,
                "read descriptor can be made nonblocking for observation"
            );

            let mut byte = 0_u8;
            let read_result = unsafe {
                libc::read(
                    observer.as_raw_fd(),
                    std::ptr::from_mut(&mut byte).cast(),
                    1,
                )
            };
            assert_eq!(read_result, -1, "an open liveness writer emits no data");
            assert_eq!(io::Error::last_os_error().kind(), io::ErrorKind::WouldBlock);

            drop(writer);
            let read_result = unsafe {
                libc::read(
                    observer.as_raw_fd(),
                    std::ptr::from_mut(&mut byte).cast(),
                    1,
                )
            };
            assert_eq!(read_result, 0, "closing the writer is its only signal");
        }

        #[test]
        fn child_receives_only_the_reader_and_observes_eof_when_writer_closes() {
            let _guard = FD_TEST_LOCK.lock().expect("descriptor test lock");
            let mut command = Command::new("/bin/sh");
            command
                .arg("-c")
                .arg("fd=$1; if IFS= read -r _ <&\"$fd\"; then exit 91; fi; printf eof")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let pending = PendingOwnerLiveness::prepare(&mut command).expect("prepare pipe");
            let mut child = command.spawn().expect("spawn pipe reader");
            let writer = pending.transfer_complete();
            drop(writer);

            let mut output = String::new();
            child
                .stdout
                .take()
                .expect("captured stdout")
                .read_to_string(&mut output)
                .expect("read child output");
            let status = child.wait().expect("wait for child");
            assert!(status.success());
            assert_eq!(output, "eof");
        }
    }
}

#[cfg(not(unix))]
mod platform {
    use std::io;
    use std::process::Command;

    #[derive(Debug)]
    pub(crate) struct OwnerLivenessWriter;

    pub(crate) struct PendingOwnerLiveness;

    impl PendingOwnerLiveness {
        pub(crate) fn prepare(_command: &mut Command) -> io::Result<Self> {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "desktop owner-liveness descriptors require Unix",
            ))
        }

        pub(crate) fn transfer_complete(self) -> OwnerLivenessWriter {
            unreachable!("an unsupported owner-liveness pipe cannot be transferred")
        }
    }
}

pub(crate) use platform::{OwnerLivenessWriter, PendingOwnerLiveness};
