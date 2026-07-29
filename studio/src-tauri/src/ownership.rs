//! Exclusive ownership of the backend's established data directory.
//!
//! The guard intentionally owns no child process.  The lifecycle supervisor
//! must acquire it before spawning a backend, and release it after reaping the
//! children it owns.  A kernel advisory lock is the source of truth: metadata
//! makes a conflicting owner actionable, while the lock is automatically
//! released when a process is forcibly quit.

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOCK_FILE_NAME: &str = ".muxed-desktop-owner.json";
const DEVELOPMENT_STACK_MARKER: &str = ".muxed-dev-stack.json";
pub(crate) const DEVELOPMENT_BACKEND_PORT: u16 = 8787;
const DEVELOPMENT_MODE_ENV: &str = "MUXED_DESKTOP_DEVELOPMENT_MODE";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnerIdentity {
    pub pid: u32,
    pub nonce: String,
    pub acquired_at_millis: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevelopmentMode {
    /// A desktop launch must be the sole writer for its data directory.
    Forbid,
    /// Deliberately use the already-running `pnpm dev` backend instead of
    /// acquiring ownership or spawning another backend.
    Connect,
}

impl DevelopmentMode {
    pub fn from_environment() -> Result<Self, OwnershipError> {
        match env::var(DEVELOPMENT_MODE_ENV) {
            Err(env::VarError::NotPresent) => Ok(Self::Forbid),
            Ok(value) => Self::parse(&value),
            Err(error) => Err(OwnershipError::Io(error.to_string())),
        }
    }

    fn parse(value: &str) -> Result<Self, OwnershipError> {
        if value == "connect" {
            Ok(Self::Connect)
        } else {
            Err(OwnershipError::InvalidDevelopmentMode(value.to_owned()))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    DataDirectoryInUse { owner: Option<OwnerIdentity> },
    DevelopmentStackDetected { port: u16 },
    DevelopmentStackUnavailable { port: u16 },
    InvalidDevelopmentMode(String),
    Io(String),
}

impl std::fmt::Display for OwnershipError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DataDirectoryInUse { owner: Some(owner) } => write!(
                formatter,
                "data directory is already owned by live process {} (owner {})",
                owner.pid, owner.nonce
            ),
            Self::DataDirectoryInUse { owner: None } => {
                write!(formatter, "data directory is already owned by another desktop instance")
            }
            Self::DevelopmentStackDetected { port } => write!(
                formatter,
                "a development backend is listening on 127.0.0.1:{port}; stop `pnpm dev` or set {DEVELOPMENT_MODE_ENV}=connect to use it deliberately"
            ),
            Self::DevelopmentStackUnavailable { port } => write!(
                formatter,
                "connect mode requires a verified `pnpm dev` backend on 127.0.0.1:{port}; start `pnpm dev` before attaching the desktop app"
            ),
            Self::InvalidDevelopmentMode(value) => write!(
                formatter,
                "{DEVELOPMENT_MODE_ENV} must be `connect` when set, got {value:?}"
            ),
            Self::Io(message) => write!(formatter, "data-directory ownership failed: {message}"),
        }
    }
}

impl std::error::Error for OwnershipError {}

/// Result of deciding how the desktop should access the local backend.
#[derive(Debug)]
pub enum DataDirectoryAccess {
    Owned(DataDirectoryGuard),
    DevelopmentStack,
}

/// An exclusive, process-scoped lease for a directory that contains SQLite
/// files and configuration.  Dropping this guard releases the kernel lock.
#[derive(Debug)]
pub struct DataDirectoryGuard {
    file: File,
    lock_path: PathBuf,
    owner: OwnerIdentity,
    reclaimed_stale_metadata: bool,
    released: bool,
}

impl DataDirectoryGuard {
    pub fn acquire_established(
        mode: DevelopmentMode,
    ) -> Result<DataDirectoryAccess, OwnershipError> {
        Self::acquire(
            &established_data_directory()?,
            mode,
            DEVELOPMENT_BACKEND_PORT,
        )
    }

    pub fn acquire(
        data_directory: &Path,
        mode: DevelopmentMode,
        development_backend_port: u16,
    ) -> Result<DataDirectoryAccess, OwnershipError> {
        fs::create_dir_all(data_directory).map_err(|error| {
            OwnershipError::Io(format!(
                "could not create selected data directory {}: {error}",
                data_directory.display()
            ))
        })?;
        match development_stack_state(data_directory, development_backend_port) {
            DevelopmentStackState::Verified => {
                if development_stack_access(mode, true, development_backend_port)? {
                    return Ok(DataDirectoryAccess::DevelopmentStack);
                }
            }
            DevelopmentStackState::Absent => {
                if mode == DevelopmentMode::Connect {
                    return Err(OwnershipError::DevelopmentStackUnavailable {
                        port: development_backend_port,
                    });
                }
            }
        }

        let lock_path = data_directory.join(LOCK_FILE_NAME);
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| {
                OwnershipError::Io(format!(
                    "could not open ownership file {}: {error}",
                    lock_path.display()
                ))
            })?;

        if !try_lock_exclusive(&file).map_err(io_error)? {
            return Err(OwnershipError::DataDirectoryInUse {
                owner: read_owner(&mut file),
            });
        }

        let previous_owner = read_owner(&mut file);
        let reclaimed_stale_metadata = previous_owner
            .as_ref()
            .is_some_and(|owner| !owner_is_alive(owner.pid));
        let owner = OwnerIdentity {
            pid: std::process::id(),
            nonce: random_nonce(),
            acquired_at_millis: now_millis(),
        };
        write_owner(&mut file, &owner).map_err(io_error)?;

        Ok(DataDirectoryAccess::Owned(Self {
            file,
            lock_path,
            owner,
            reclaimed_stale_metadata,
            released: false,
        }))
    }

    pub fn owner(&self) -> &OwnerIdentity {
        &self.owner
    }

    pub fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    pub fn reclaimed_stale_metadata(&self) -> bool {
        self.reclaimed_stale_metadata
    }

    pub fn release(mut self) -> Result<(), OwnershipError> {
        self.release_inner()
    }

    fn release_inner(&mut self) -> Result<(), OwnershipError> {
        if self.released {
            return Ok(());
        }
        clear_owner(&mut self.file).map_err(io_error)?;
        unlock(&self.file).map_err(io_error)?;
        self.released = true;
        Ok(())
    }
}

impl Drop for DataDirectoryGuard {
    fn drop(&mut self) {
        let _ = self.release_inner();
    }
}

/// The existing path shared by browser development and installed desktop
/// builds.  This deliberately does not move or copy configuration.
pub fn established_data_directory() -> Result<PathBuf, OwnershipError> {
    if let Some(value) = env::var_os("MUXED_DATA_DIR") {
        if !value.is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    let home = env::var_os("HOME").ok_or_else(|| {
        OwnershipError::Io("could not determine HOME for the established data directory".to_owned())
    })?;
    Ok(PathBuf::from(home).join(".config/worktracker-studio"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevelopmentStackState {
    Absent,
    Verified,
}

#[derive(Debug, Serialize, Deserialize)]
struct DevelopmentStackMarker {
    data_dir: PathBuf,
    supervisor_pid: u32,
    backend_port: u16,
}

fn development_stack_state(data_directory: &Path, port: u16) -> DevelopmentStackState {
    let marker_path = data_directory.join(DEVELOPMENT_STACK_MARKER);
    let marker = fs::read_to_string(&marker_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<DevelopmentStackMarker>(&contents).ok());
    if let Some(marker) = marker {
        if marker.backend_port == port
            && owner_is_alive(marker.supervisor_pid)
            && paths_match(&marker.data_dir, data_directory)
        {
            return DevelopmentStackState::Verified;
        }
        if !owner_is_alive(marker.supervisor_pid) {
            let _ = fs::remove_file(marker_path);
        }
    }
    DevelopmentStackState::Absent
}

fn paths_match(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn development_stack_access(
    mode: DevelopmentMode,
    development_stack_is_running: bool,
    port: u16,
) -> Result<bool, OwnershipError> {
    if !development_stack_is_running {
        return Ok(false);
    }
    match mode {
        DevelopmentMode::Connect => Ok(true),
        DevelopmentMode::Forbid => Err(OwnershipError::DevelopmentStackDetected { port }),
    }
}

fn read_owner(file: &mut File) -> Option<OwnerIdentity> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_owner(file: &mut File, owner: &OwnerIdentity) -> std::io::Result<()> {
    let encoded =
        serde_json::to_vec(owner).map_err(|error| std::io::Error::other(error.to_string()))?;
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&encoded)?;
    file.sync_data()
}

fn clear_owner(file: &mut File) -> std::io::Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.sync_data()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn random_nonce() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect()
}

fn io_error(error: std::io::Error) -> OwnershipError {
    OwnershipError::Io(error.to_string())
}

#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> std::io::Result<bool> {
    use std::os::fd::AsRawFd;

    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        Ok(true)
    } else {
        match std::io::Error::last_os_error().kind() {
            std::io::ErrorKind::WouldBlock => Ok(false),
            _ => Err(std::io::Error::last_os_error()),
        }
    }
}

#[cfg(unix)]
fn unlock(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;

    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn try_lock_exclusive(_file: &File) -> std::io::Result<bool> {
    // This target is not part of the current desktop release.  Refuse rather
    // than pretending that an unlocked metadata file provides exclusivity.
    Ok(false)
}

#[cfg(not(unix))]
fn unlock(_file: &File) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn owner_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0
        || matches!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::EPERM)
        )
}

#[cfg(not(unix))]
fn owner_is_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_data_directory(name: &str) -> PathBuf {
        let directory = env::temp_dir().join(format!(
            "muxed-ownership-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(&directory).expect("create test data directory");
        directory
    }

    fn acquire_owned(directory: &Path) -> DataDirectoryGuard {
        match DataDirectoryGuard::acquire(directory, DevelopmentMode::Forbid, 0)
            .expect("ownership acquisition")
        {
            DataDirectoryAccess::Owned(guard) => guard,
            DataDirectoryAccess::DevelopmentStack => panic!("port zero cannot be a dev stack"),
        }
    }

    #[test]
    fn two_instances_cannot_own_one_data_directory() {
        let directory = temp_data_directory("exclusive");
        let first = acquire_owned(&directory);
        let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
            .expect_err("second owner must be refused");

        assert!(matches!(error, OwnershipError::DataDirectoryInUse { .. }));
        first.release().expect("release first owner");
        let second = acquire_owned(&directory);
        second.release().expect("release second owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn contended_explicit_data_directory_diagnostic_names_the_directory() {
        let directory = temp_data_directory("explicit-contention");
        let first = acquire_owned(&directory);
        let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
            .expect_err("second owner must be refused");
        let diagnostic = format!(
            "could not own selected data directory {}: {error}",
            directory.display()
        );

        assert!(diagnostic.contains(&directory.display().to_string()));
        assert!(diagnostic.contains("already owned"));
        first.release().expect("release first owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn distinct_data_directories_can_be_owned_concurrently_and_isolate_writes() {
        let first_directory = temp_data_directory("concurrent-first");
        let second_directory = temp_data_directory("concurrent-second");
        let first = acquire_owned(&first_directory);
        let second = acquire_owned(&second_directory);

        fs::write(first_directory.join("sentinel"), b"first profile")
            .expect("write first profile sentinel");
        assert!(!second_directory.join("sentinel").exists());

        first.release().expect("release first owner");
        second.release().expect("release second owner");
        fs::remove_dir_all(first_directory).expect("clean first test directory");
        fs::remove_dir_all(second_directory).expect("clean second test directory");
    }

    #[test]
    fn an_uncreatable_selected_directory_is_named_in_the_error() {
        let parent = temp_data_directory("uncreatable");
        let file = parent.join("not-a-directory");
        fs::write(&file, b"blocking file").expect("create blocking file");
        let selected = file.join("profile");

        let error = DataDirectoryGuard::acquire(&selected, DevelopmentMode::Forbid, 0)
            .expect_err("directory beneath a file must be rejected");

        assert!(error.to_string().contains(&selected.display().to_string()));
        fs::remove_dir_all(parent).expect("clean test directory");
    }

    #[test]
    fn stale_metadata_is_reclaimed_without_manual_cleanup() {
        let directory = temp_data_directory("stale");
        let lock_path = directory.join(LOCK_FILE_NAME);
        let stale = OwnerIdentity {
            pid: 999_999,
            nonce: "forced-quit-owner".to_owned(),
            acquired_at_millis: 1,
        };
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(lock_path)
            .expect("create stale metadata");
        write_owner(&mut file, &stale).expect("write stale metadata");
        drop(file);

        let guard = acquire_owned(&directory);
        assert!(guard.reclaimed_stale_metadata());
        guard.release().expect("release relaunched owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn an_existing_data_directory_is_used_in_place() {
        let directory = temp_data_directory("existing");
        let existing = directory.join("state.db");
        fs::write(&existing, b"existing sqlite bytes").expect("seed existing state");

        let guard = acquire_owned(&directory);
        assert_eq!(
            fs::read(&existing).expect("read existing state"),
            b"existing sqlite bytes"
        );
        guard.release().expect("release owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn a_fresh_data_directory_is_created_without_a_layout_migration() {
        let directory = env::temp_dir().join(format!(
            "muxed-ownership-fresh-{}-{}",
            std::process::id(),
            now_millis()
        ));
        assert!(!directory.exists(), "test path must begin absent");

        let guard = acquire_owned(&directory);
        assert!(directory.is_dir());
        assert_eq!(guard.lock_path(), directory.join(LOCK_FILE_NAME));
        guard.release().expect("release owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn forced_quit_child() {
        let Some(directory) = env::var_os("MUXED_OWNERSHIP_FORCED_QUIT_DIRECTORY") else {
            return;
        };
        let _guard = acquire_owned(Path::new(&directory));
        // Deliberately bypass Drop to model a process that the OS terminates.
        std::process::exit(0);
    }

    #[test]
    fn forced_quit_relaunches_without_manual_cleanup() {
        let directory = temp_data_directory("forced-quit");
        let status = std::process::Command::new(env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "ownership::tests::forced_quit_child",
                "--nocapture",
            ])
            .env("MUXED_OWNERSHIP_FORCED_QUIT_DIRECTORY", &directory)
            .status()
            .expect("start forced-quit owner");
        assert!(status.success());

        let guard = acquire_owned(&directory);
        assert!(guard.reclaimed_stale_metadata());
        guard.release().expect("release relaunched owner");
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn running_dev_backend_requires_explicit_connect_mode() {
        let port = 8787;
        let error = development_stack_access(DevelopmentMode::Forbid, true, port)
            .expect_err("implicit dev sharing must fail");
        assert!(matches!(
            error,
            OwnershipError::DevelopmentStackDetected { port: detected } if detected == port
        ));
        assert!(
            development_stack_access(DevelopmentMode::Connect, true, port)
                .expect("explicit dev mode")
        );
    }

    #[test]
    fn connect_mode_without_a_verified_development_stack_fails_closed() {
        let directory = temp_data_directory("connect-without-stack");
        let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Connect, 0)
            .expect_err("connect mode must never fall through to owned sidecar mode");

        assert!(matches!(
            error,
            OwnershipError::DevelopmentStackUnavailable { port: 0 }
        ));
        assert!(error.to_string().contains("start `pnpm dev`"));
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn matching_dev_stack_marker_allows_only_explicit_connect_mode() {
        let directory = temp_data_directory("dev-marker");
        let marker = DevelopmentStackMarker {
            data_dir: directory.clone(),
            supervisor_pid: std::process::id(),
            backend_port: 0,
        };
        fs::write(
            directory.join(DEVELOPMENT_STACK_MARKER),
            serde_json::to_vec(&marker).expect("serialize marker"),
        )
        .expect("write marker");

        assert_eq!(
            development_stack_state(&directory, 0),
            DevelopmentStackState::Verified
        );
        let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
            .expect_err("implicit dev sharing must fail");
        assert!(matches!(
            error,
            OwnershipError::DevelopmentStackDetected { port: 0 }
        ));
        assert!(matches!(
            DataDirectoryGuard::acquire(&directory, DevelopmentMode::Connect, 0)
                .expect("explicit dev connect"),
            DataDirectoryAccess::DevelopmentStack
        ));
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn marker_for_another_data_directory_does_not_enable_connect_mode() {
        let directory = temp_data_directory("dev-marker-mismatch");
        let other_directory = temp_data_directory("dev-marker-other");
        let marker = DevelopmentStackMarker {
            data_dir: other_directory.clone(),
            supervisor_pid: std::process::id(),
            backend_port: 0,
        };
        fs::write(
            directory.join(DEVELOPMENT_STACK_MARKER),
            serde_json::to_vec(&marker).expect("serialize marker"),
        )
        .expect("write marker");

        assert_eq!(
            development_stack_state(&directory, 0),
            DevelopmentStackState::Absent
        );
        let guard = acquire_owned(&directory);
        guard.release().expect("release owner");
        fs::remove_dir_all(directory).expect("clean test directory");
        fs::remove_dir_all(other_directory).expect("clean test directory");
    }

    #[test]
    fn unrelated_listener_on_the_development_port_does_not_block_ownership() {
        let directory = temp_data_directory("unrelated-development-port");
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .expect("bind unrelated local service");
        let port = listener.local_addr().expect("listener address").port();

        let guard = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, port)
            .expect("an unrelated service on the conventional port must not own this directory");
        assert!(matches!(guard, DataDirectoryAccess::Owned(_)));

        drop(listener);
        drop(guard);
        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn invalid_development_mode_is_actionable() {
        assert!(matches!(
            DevelopmentMode::parse("true"),
            Err(OwnershipError::InvalidDevelopmentMode(value)) if value == "true"
        ));
    }
}
