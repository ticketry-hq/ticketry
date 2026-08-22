//! Ownership of one desktop-spawned sidecar process and its descendants.
//!
//! The desktop shell owns exactly the sidecars it spawned.  This module is the
//! only place that knows how a sidecar is contained: on Unix each command is
//! spawned as the leader of its own process group through
//! [`process_wrap`](https://docs.rs/process-wrap/latest/process_wrap/), so a
//! PyInstaller bootloader's worker is reachable alongside the direct child.
//!
//! The abstraction deliberately offers no PID accessor, no process discovery,
//! and no adoption of processes this shell did not spawn.  Callers can only
//! read the standard streams, ask whether the owned processes are still
//! running, request a cooperative stop, wait for a bounded grace period, force
//! the group to stop, and reap the direct child.  Supervision policy — grace
//! periods, ordering, readiness, recovery, and error precedence — lives in the
//! supervisor, not here.
//!
//! Every exit path ends in the same forced teardown, including the destructor:
//! a handle dropped before it reaches the supervisor's state — a startup that
//! failed after the spawn, an unwinding panic — still takes its group with it.
//!
//! Cleanup is only best effort when the owner itself dies.  Rust destructors
//! run while the owning process is still alive and unwinding normally; they
//! cannot run after an abrupt owner death — a macOS `SIGKILL` (including Force
//! Quit and the out-of-memory killer), a power loss, a build configured to
//! abort on panic, or an operating-system crash.  POSIX process groups carry no
//! parent-death guarantee, so an abruptly killed desktop app may leave its
//! sidecar group behind.  The next launch reclaims the data-directory lock the
//! kernel released and owns only the sidecars it spawns itself; it never adopts
//! or signals the stranded ones.
//!
//! Containment is also not a cage.  A descendant that deliberately leaves the
//! owned group — by calling `setsid`, or by joining a group this shell never
//! created — is no longer addressable through the owned group, and nothing here
//! promises to clean it up.  The boundary is exactly the handles this module
//! spawned: it never searches for a process by identifier, by loopback port, by
//! executable name, by `tmux` command, or by durable terminal session.

use std::io;
use std::process::{ChildStderr, ChildStdout, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use process_wrap::std::ProcessGroup;
use process_wrap::std::{ChildWrapper, CommandWrap};

/// A sidecar process this supervisor spawned, plus every process still inside
/// the process group it leads.
#[derive(Debug)]
pub(crate) struct OwnedSidecar {
    child: Box<dyn ChildWrapper>,
    /// The identifier of the owned process group, captured at spawn so that a
    /// reaped direct child cannot leave the group unaddressable.
    #[cfg(unix)]
    group: i32,
    direct_child_exit: Option<ExitStatus>,
}

impl OwnedSidecar {
    /// Spawns an already-configured command as an owned sidecar.
    ///
    /// The caller applies the fixed arguments, environment, standard I/O, and
    /// packaged-environment sanitisation first; this only adds containment.
    pub(crate) fn spawn(command: Command) -> io::Result<Self> {
        let mut wrapped = CommandWrap::from(command);
        #[cfg(unix)]
        wrapped.wrap(ProcessGroup::leader());
        let child = wrapped.spawn()?;
        #[cfg(unix)]
        let group = i32::try_from(child.id()).map_err(|_| {
            io::Error::other("owned sidecar process identifier exceeds the process-group range")
        })?;
        Ok(Self {
            child,
            #[cfg(unix)]
            group,
            direct_child_exit: None,
        })
    }

    /// Takes the captured standard output, for the supervisor's log readers.
    pub(crate) fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout().take()
    }

    /// Takes the captured standard error, for the supervisor's log readers.
    pub(crate) fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr().take()
    }

    /// Reports the direct child's exit status without blocking, reaping it and
    /// any owned zombies in the same group.
    pub(crate) fn try_direct_child_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.direct_child_exit.is_none() {
            match self.child.try_wait() {
                Ok(Some(status)) => self.direct_child_exit = Some(status),
                Ok(None) => {}
                // The group wait already reaped the direct child, so its status
                // is gone but its exit is certain.
                Err(error) if is_no_child(&error) => {
                    self.direct_child_exit = Some(reaped_elsewhere_status());
                }
                Err(error) => return Err(error),
            }
        }
        Ok(self.direct_child_exit)
    }

    /// Asks the whole owned group to stop cooperatively.
    ///
    /// A group that no longer exists is an error here: the caller asked to stop
    /// something it believed it owned, and the supervisor reports that as a
    /// service teardown failure exactly as it did before.
    pub(crate) fn request_graceful_stop(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.child.signal(libc::SIGTERM)
        }
        #[cfg(not(unix))]
        {
            // `std::process` exposes no cross-platform soft signal.  Give the
            // owned child its configured grace period (for a future sidecar
            // control channel) before the caller escalates; never kill early.
            Ok(())
        }
    }

    /// Waits up to `grace` for the direct child and every other process in the
    /// owned group to exit.  Returns whether they all stopped in time.
    pub(crate) fn wait_for_owned_exit(&mut self, grace: Duration) -> io::Result<bool> {
        let deadline = Instant::now() + grace;
        loop {
            let direct_child_exited = self.try_direct_child_exit()?.is_some();
            if direct_child_exited && !self.owned_group_exists() {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// Forces the whole owned group to stop and reaps the direct child.
    ///
    /// A group that has already gone away counts as stopped once the direct
    /// child has been reaped.
    pub(crate) fn terminate_and_reap(&mut self) -> io::Result<()> {
        let kill_result = match self.child.start_kill() {
            Err(error) if is_missing_process(&error) => Ok(()),
            other => other,
        };
        let wait_result = self.reap_direct_child();
        kill_result.and(wait_result)
    }

    /// The same forced teardown, for paths that must not fail: `Drop` and
    /// cleanup after an earlier teardown error.
    pub(crate) fn terminate_and_reap_best_effort(&mut self) {
        let _ = self.terminate_and_reap();
    }

    fn reap_direct_child(&mut self) -> io::Result<()> {
        if self.direct_child_exit.is_some() {
            return Ok(());
        }
        // Wait on the direct child alone.  Waiting on the whole group would
        // block forever on a descendant that deliberately escaped it.
        match self.child.inner_mut().wait() {
            Ok(status) => {
                self.direct_child_exit = Some(status);
                Ok(())
            }
            Err(error) if is_no_child(&error) => {
                self.direct_child_exit = Some(reaped_elsewhere_status());
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    /// Whether any process still belongs to the owned group.
    ///
    /// This probes with the null signal, which delivers nothing.  It stays a
    /// direct system call because a group-wide wait only observes this
    /// process's own children, and so cannot see a descendant that outlived the
    /// direct child it was spawned from.
    #[cfg(unix)]
    fn owned_group_exists(&self) -> bool {
        group_exists(self.group)
    }

    #[cfg(not(unix))]
    fn owned_group_exists(&self) -> bool {
        // Without process groups the direct child is the whole owned set, and
        // its exit is already established by `try_direct_child_exit`.
        false
    }
}

impl Drop for OwnedSidecar {
    /// The last exit path, for every handle that goes away without an explicit
    /// teardown: a failed startup, an unwinding panic, an owner leaving scope.
    ///
    /// Supervision paths that need ordering, grace, or events still tear down
    /// explicitly; forced teardown is idempotent, so running again here costs
    /// nothing and no owned group depends on a caller remembering.
    fn drop(&mut self) {
        self.terminate_and_reap_best_effort();
    }
}

/// Whether any process still belongs to `group`, probed with the null signal.
/// Kept separate from the handle so a released group can still be observed
/// after the handle that owned it has gone.
#[cfg(unix)]
fn group_exists(group: i32) -> bool {
    let outcome = unsafe { libc::kill(-group, 0) };
    outcome == 0 || io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(unix)]
fn is_missing_process(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::ESRCH)
}

#[cfg(not(unix))]
fn is_missing_process(_error: &io::Error) -> bool {
    false
}

#[cfg(unix)]
fn is_no_child(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::ECHILD)
}

#[cfg(not(unix))]
fn is_no_child(_error: &io::Error) -> bool {
    false
}

/// The status recorded when the direct child was reaped by a group wait, which
/// consumes the real status. The process is known to be gone.
#[cfg(unix)]
fn reaped_elsewhere_status() -> ExitStatus {
    use std::os::unix::process::ExitStatusExt;

    ExitStatus::from_raw(0)
}

#[cfg(not(unix))]
fn reaped_elsewhere_status() -> ExitStatus {
    unreachable!("only a Unix group wait can reap the direct child out of band")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    const GRACE: Duration = Duration::from_secs(5);
    const IMPATIENT: Duration = Duration::from_millis(150);
    const READY: &str = "echo owned-sidecar-ready";

    /// A shell sidecar, so these tests exercise real process-group behaviour
    /// rather than a mock of it.  The script must announce itself with
    /// [`READY`] once its signal disposition is installed, so that no test
    /// signals a process that is still starting up.
    fn shell_sidecar(script: &str) -> OwnedSidecar {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut sidecar = OwnedSidecar::spawn(command).expect("spawn owned sidecar");
        let stdout = sidecar.take_stdout().expect("standard output is captured");
        let mut announcement = String::new();
        BufReader::new(stdout)
            .read_line(&mut announcement)
            .expect("read the sidecar's announcement");
        assert_eq!(announcement.trim(), "owned-sidecar-ready");
        sidecar
    }

    /// A reaped process leaves no zombie, so eventually nothing answers for the
    /// group.  Forced termination is asynchronous, so this waits for it.
    fn assert_group_is_gone(sidecar: &OwnedSidecar) {
        assert_released(sidecar.group);
    }

    /// The same wait, for a group whose handle no longer exists to ask.
    fn assert_released(group: i32) {
        let deadline = Instant::now() + GRACE;
        while group_exists(group) {
            assert!(
                Instant::now() < deadline,
                "a surviving or unreaped process still belongs to the owned group"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// The owned group of a sidecar that is about to be dropped, so the test
    /// can keep watching it once the handle no longer exists.
    fn owned_group_of(sidecar: &OwnedSidecar) -> i32 {
        sidecar.group
    }

    #[test]
    fn a_cooperative_sidecar_stops_on_the_graceful_request_and_is_reaped() {
        let mut sidecar = shell_sidecar(&format!(
            "trap 'exit 0' TERM; {READY}; while :; do sleep 0.05; done"
        ));

        sidecar
            .request_graceful_stop()
            .expect("the owned group accepts SIGTERM");

        assert!(
            sidecar
                .wait_for_owned_exit(GRACE)
                .expect("bounded wait succeeds"),
            "a cooperative sidecar exits within its grace period"
        );
        assert!(sidecar
            .try_direct_child_exit()
            .expect("exit status is readable")
            .is_some());
        assert_group_is_gone(&sidecar);
    }

    #[test]
    fn an_uncooperative_sidecar_outlasts_the_grace_period_and_is_then_forced_out() {
        let mut sidecar = shell_sidecar(&format!(
            "trap '' TERM; {READY}; while :; do sleep 0.05; done"
        ));

        sidecar.request_graceful_stop().expect("SIGTERM is sent");
        assert!(
            !sidecar
                .wait_for_owned_exit(IMPATIENT)
                .expect("bounded wait succeeds"),
            "a sidecar that ignores SIGTERM must not be reported as stopped"
        );

        sidecar
            .terminate_and_reap()
            .expect("forced termination stops and reaps the sidecar");

        assert!(sidecar
            .try_direct_child_exit()
            .expect("exit status is readable")
            .is_some());
        assert_group_is_gone(&sidecar);
    }

    #[test]
    fn an_exited_direct_child_does_not_hide_a_surviving_owned_descendant() {
        // The direct child exits immediately while its descendant stays in the
        // owned group and ignores SIGTERM: the two take different exit paths.
        let mut sidecar = shell_sidecar(&format!(
            "sh -c 'trap \"\" TERM; {READY}; sleep 30' & exit 0"
        ));

        assert!(
            !sidecar
                .wait_for_owned_exit(IMPATIENT)
                .expect("bounded wait succeeds"),
            "a reaped direct child must not mask a live owned descendant"
        );
        assert!(
            sidecar
                .try_direct_child_exit()
                .expect("exit status is readable")
                .is_some(),
            "the direct child has already exited"
        );

        sidecar
            .terminate_and_reap()
            .expect("forced termination reaches the whole owned group");

        assert_group_is_gone(&sidecar);
    }

    #[test]
    fn forced_termination_is_idempotent_once_the_group_has_gone() {
        let mut sidecar = shell_sidecar(&format!("{READY}; while :; do sleep 0.05; done"));
        sidecar.terminate_and_reap().expect("first teardown");

        sidecar
            .terminate_and_reap()
            .expect("a second teardown of an already-stopped sidecar succeeds");

        assert_group_is_gone(&sidecar);
    }

    /// The containment boundary is the handles this module spawned.  A future
    /// change that reached for a process by identifier, loopback port,
    /// executable name, `tmux` command, or terminal session would silently
    /// widen the blast radius past the sidecars the desktop shell owns, so the
    /// implementation is held to naming none of those ways of finding a
    /// process.  Only the implementation is inspected; these tests deliberately
    /// name the very techniques being excluded.
    #[test]
    fn the_containment_boundary_never_searches_for_a_process_it_did_not_spawn() {
        let implementation = include_str!("owned_sidecar.rs")
            .split("#[cfg(all(test, unix))]")
            .next()
            .expect("the implementation precedes its tests")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<String>();

        for technique in [
            "pkill",
            "killall",
            "pgrep",
            "ps ",
            "lsof",
            "tmux",
            "kill-session",
            "list-sessions",
            "/proc",
            "sysctl",
            "proc_listpids",
            "current_exe",
        ] {
            assert!(
                !implementation.contains(technique),
                "containment must not find processes with `{technique}`"
            );
        }
        assert!(
            !implementation.contains("pub(crate) fn pid"),
            "exposing a process identifier invites signalling outside the owned group"
        );
    }

    /// A handle that never reaches the supervisor's state has no explicit
    /// teardown behind it, so the destructor is the only thing between a failed
    /// startup and a stranded group.  The sidecar here ignores SIGTERM and
    /// keeps a descendant alive, so nothing but the forced teardown in `Drop`
    /// can release the group.
    #[test]
    fn a_dropped_sidecar_releases_its_owned_group() {
        let group = {
            let sidecar = shell_sidecar(&format!(
                "trap '' TERM; sh -c 'trap \"\" TERM; sleep 30' & {READY}; wait"
            ));
            owned_group_of(&sidecar)
        };

        assert_released(group);
    }

    #[test]
    fn a_stopped_sidecar_refuses_a_later_graceful_stop_request() {
        let mut sidecar = shell_sidecar(&format!("{READY}; while :; do sleep 0.05; done"));
        sidecar.terminate_and_reap().expect("teardown");

        sidecar
            .request_graceful_stop()
            .expect_err("nothing remains to receive SIGTERM");
    }
}
