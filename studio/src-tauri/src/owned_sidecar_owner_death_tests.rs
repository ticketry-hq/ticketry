//! Cross-boundary owner-death contracts for the desktop-owned backend.

use crate::owned_sidecar::OwnedSidecar;
use std::env;
use std::fs;
use std::io;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(5);
const OWNER_FIXTURE: &str = "TICKETRY_OWNER_DEATH_OWNER_FIXTURE";
const WORKER_FIXTURE: &str = "TICKETRY_OWNER_DEATH_WORKER_FIXTURE";
const MODE: &str = "TICKETRY_OWNER_DEATH_MODE";
const OWNER_FD: &str = "TICKETRY_OWNER_DEATH_FD";
const PORT: &str = "TICKETRY_OWNER_DEATH_PORT";
const DIRECT_PID: &str = "TICKETRY_OWNER_DEATH_DIRECT_PID";
const WORKER_PID: &str = "TICKETRY_OWNER_DEATH_WORKER_PID";
const OWNER_READY: &str = "TICKETRY_OWNER_DEATH_OWNER_READY";
const STARTUP: &str = "TICKETRY_OWNER_DEATH_STARTUP";
const READY: &str = "TICKETRY_OWNER_DEATH_READY";
const CLOSE_OWNER: &str = "TICKETRY_OWNER_DEATH_CLOSE_OWNER";
const SHUTDOWN: &str = "TICKETRY_OWNER_DEATH_SHUTDOWN";
const STARTUP_STOPPED: &str = "TICKETRY_OWNER_DEATH_STARTUP_STOPPED";

static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct OwnerHarness {
    root: PathBuf,
    port: u16,
    owner: Child,
}

impl OwnerHarness {
    fn start(mode: &str, orderly_close: bool) -> Self {
        let root = env::temp_dir().join(format!(
            "ticketry-owner-death-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("create owner-death fixture directory");
        let listener = TcpListener::bind("127.0.0.1:0").expect("reserve loopback resource");
        let port = listener.local_addr().expect("loopback address").port();
        drop(listener);

        let executable = env::current_exe().expect("current Rust test executable");
        let mut command = Command::new(&executable);
        command
            .args([
                "--exact",
                "owned_sidecar_owner_death_tests::owner_process_fixture",
                "--nocapture",
            ])
            .env(OWNER_FIXTURE, "1")
            .env(MODE, mode)
            .env(PORT, port.to_string())
            .env(DIRECT_PID, root.join("direct.pid"))
            .env(WORKER_PID, root.join("worker.pid"))
            .env(OWNER_READY, root.join("owner.ready"))
            .env(STARTUP, root.join("startup"))
            .env(READY, root.join("ready"))
            .env(CLOSE_OWNER, root.join("close-owner"))
            .env(SHUTDOWN, root.join("shutdown"))
            .env(STARTUP_STOPPED, root.join("startup-stopped"))
            .env("TICKETRY_OWNER_DEATH_ORDERLY", orderly_close.to_string())
            .env("TICKETRY_OWNER_DEATH_WORKER", &executable)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let owner = command.spawn().expect("start desktop-owner fixture");
        wait_for_path(&root.join("owner.ready"));

        Self { root, port, owner }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn backend_pids(&self) -> (u32, u32) {
        (
            read_pid(&self.path("direct.pid")),
            read_pid(&self.path("worker.pid")),
        )
    }

    fn assert_backend_released(&self, pids: (u32, u32)) {
        wait_for_process_exit(pids.1);
        wait_for_process_exit(pids.0);
        let listener = TcpListener::bind(("127.0.0.1", self.port))
            .expect("the backend's loopback resource is rebindable");
        drop(listener);
        assert_eq!(
            fs::read_to_string(self.path("shutdown")).expect("cooperative shutdown evidence"),
            "lifespan.shutdown.complete"
        );
    }
}

impl Drop for OwnerHarness {
    fn drop(&mut self) {
        if self.owner.try_wait().ok().flatten().is_none() {
            let _ = self.owner.kill();
            let _ = self.owner.wait();
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn orderly_writer_close_cooperatively_stops_the_backend_tree() {
    let mut harness = OwnerHarness::start("serving", true);
    wait_for_path(&harness.path("ready"));
    let pids = harness.backend_pids();

    fs::write(harness.path("close-owner"), b"close").expect("request orderly writer close");
    assert!(
        harness
            .owner
            .wait_timeout(DEADLINE)
            .expect("wait for owner fixture")
            .success(),
        "the orderly owner fixture exits successfully"
    );

    harness.assert_backend_released(pids);
}

#[test]
fn sigkill_of_the_owner_cooperatively_stops_the_backend_tree() {
    let mut harness = OwnerHarness::start("serving", false);
    wait_for_path(&harness.path("ready"));
    let pids = harness.backend_pids();

    assert_eq!(
        unsafe { libc::kill(harness.owner.id() as i32, libc::SIGKILL) },
        0
    );
    let status = harness
        .owner
        .wait_timeout(DEADLINE)
        .expect("reap killed owner fixture");
    assert!(
        !status.success(),
        "SIGKILL is observable at the owner boundary"
    );

    harness.assert_backend_released(pids);
}

#[test]
fn sigkill_before_readiness_cancels_backend_startup() {
    let mut harness = OwnerHarness::start("pre-ready", false);
    wait_for_path(&harness.path("startup"));
    let pids = harness.backend_pids();

    assert_eq!(
        unsafe { libc::kill(harness.owner.id() as i32, libc::SIGKILL) },
        0
    );
    let _ = harness
        .owner
        .wait_timeout(DEADLINE)
        .expect("reap killed owner fixture");
    wait_for_process_exit(pids.1);
    wait_for_process_exit(pids.0);

    assert!(
        !harness.path("ready").exists(),
        "readiness is never emitted"
    );
    assert_eq!(
        fs::read_to_string(harness.path("startup-stopped")).expect("startup cancellation evidence"),
        "owner-eof"
    );
}

#[test]
fn owner_process_fixture() {
    if env::var_os(OWNER_FIXTURE).is_none() {
        return;
    }
    let script = r#"
        test "$1" = --owner-fd || exit 71
        export TICKETRY_OWNER_DEATH_FD="$2"
        printf '%s' "$$" > "$TICKETRY_OWNER_DEATH_DIRECT_PID"
        "$TICKETRY_OWNER_DEATH_WORKER" \
          --exact owned_sidecar_owner_death_tests::backend_worker_fixture \
          --nocapture &
        wait "$!"
    "#;
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", script, "ticketry-pyinstaller-bootloader"])
        .env(WORKER_FIXTURE, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut sidecar = OwnedSidecar::spawn_backend(command).expect("spawn backend-shaped sidecar");
    fs::write(required_path(OWNER_READY), b"ready").expect("announce owner fixture");

    if env::var("TICKETRY_OWNER_DEATH_ORDERLY").as_deref() == Ok("true") {
        wait_for_path(&required_path(CLOSE_OWNER));
        sidecar.release_owner_liveness();
        assert!(
            sidecar
                .wait_for_owned_exit(DEADLINE)
                .expect("wait for EOF-driven backend exit"),
            "backend exits after an orderly writer close"
        );
    } else {
        loop {
            thread::park();
        }
    }
}

#[test]
fn backend_worker_fixture() {
    if env::var_os(WORKER_FIXTURE).is_none() {
        return;
    }
    let descriptor = env::var(OWNER_FD)
        .expect("owner descriptor")
        .parse::<i32>()
        .expect("numeric owner descriptor");
    fs::write(required_path(WORKER_PID), std::process::id().to_string())
        .expect("record backend worker process");
    fs::write(required_path(STARTUP), b"started").expect("record backend startup");

    if env::var(MODE).as_deref() == Ok("pre-ready") {
        wait_for_owner_eof(descriptor);
        fs::write(required_path(STARTUP_STOPPED), b"owner-eof").expect("record cancelled startup");
        return;
    }

    let port = env::var(PORT)
        .expect("backend port")
        .parse::<u16>()
        .expect("numeric backend port");
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind backend resource");
    fs::write(required_path(READY), b"ready").expect("announce backend readiness");
    wait_for_owner_eof(descriptor);
    fs::write(required_path(SHUTDOWN), b"lifespan.shutdown.complete")
        .expect("record cooperative ASGI shutdown");
    drop(listener);
}

fn wait_for_owner_eof(descriptor: i32) {
    let mut byte = 0_u8;
    let read = unsafe { libc::read(descriptor, (&mut byte as *mut u8).cast(), 1) };
    assert_eq!(read, 0, "the private owner channel ends at EOF");
}

fn required_path(name: &str) -> PathBuf {
    PathBuf::from(env::var_os(name).expect("fixture path"))
}

fn wait_for_path(path: &Path) {
    let deadline = Instant::now() + DEADLINE;
    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_pid(path: &Path) -> u32 {
    wait_for_path(path);
    fs::read_to_string(path)
        .expect("read fixture process identifier")
        .parse()
        .expect("numeric fixture process identifier")
}

fn wait_for_process_exit(pid: u32) {
    let deadline = Instant::now() + DEADLINE;
    while process_exists(pid) {
        assert!(
            Instant::now() < deadline,
            "process {pid} survived owner death"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn process_exists(pid: u32) -> bool {
    let outcome = unsafe { libc::kill(pid as i32, 0) };
    outcome == 0 || io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

trait ChildWaitTimeout {
    fn wait_timeout(&mut self, timeout: Duration) -> io::Result<std::process::ExitStatus>;
}

impl ChildWaitTimeout for Child {
    fn wait_timeout(&mut self, timeout: Duration) -> io::Result<std::process::ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.try_wait()? {
                return Ok(status);
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "child did not exit",
                ));
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}
