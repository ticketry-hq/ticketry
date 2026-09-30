use std::backtrace::Backtrace;
use std::cell::RefCell;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::panic::UnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::ThreadId;

use serde::{Deserialize, Serialize};

const SESSION_MARKER_FILE: &str = "session-marker.json";
const PANIC_ATTRIBUTION_FILE: &str = "panic-attribution.json";

static INSTALLING_THREAD: OnceLock<ThreadId> = OnceLock::new();
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static LAST_COMMITTED_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static STAGING_LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    static PANIC_STATE: RefCell<Option<PanicState>> = const { RefCell::new(None) };
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum RecoveryScope {
    ExplicitCatch,
    ProcessRoot,
    ThreadRoot,
    TokioTask(tokio::task::Id),
}

struct PanicState {
    scope: RecoveryScope,
    hook_count: u8,
    first_attribution: Option<PendingAttribution>,
}

struct PendingAttribution {
    panic_message: String,
    rust_backtrace: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct PanicAttribution {
    pub(crate) session_id: String,
    pub(crate) panic_message: String,
    pub(crate) rust_backtrace: String,
}

#[derive(Deserialize)]
struct SessionIdentity {
    session_id: String,
}

pub(crate) fn read_for_session(
    data_directory: &Path,
    session_id: &str,
) -> Option<PanicAttribution> {
    let path = attribution_path(data_directory);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            eprintln!(
                "Ticketry could not read panic attribution {}: {error}",
                path.display()
            );
            return None;
        }
    };
    let attribution = match serde_json::from_slice::<PanicAttribution>(&bytes) {
        Ok(attribution) => attribution,
        Err(error) => {
            eprintln!(
                "Ticketry could not read panic attribution {}: {error}",
                path.display()
            );
            return None;
        }
    };
    (attribution.session_id == session_id).then_some(attribution)
}

pub(crate) fn clear(data_directory: &Path) {
    let path = attribution_path(data_directory);
    if let Err(error) = fs::remove_file(&path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "Ticketry could not remove stale panic attribution {}: {error}",
                path.display()
            );
        }
    }
}

/// Record panics before the process can abort, then run the existing reporter.
pub fn install_hook(data_directory: &Path) {
    let marker = data_directory.join(SESSION_MARKER_FILE);
    let attribution = attribution_path(data_directory);
    let _ = INSTALLING_THREAD.set(std::thread::current().id());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        if let Some(pending) = crash_attribution(panic) {
            let token = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
            if let Err(error) = stage(
                &marker,
                &attribution,
                pending.panic_message,
                pending.rust_backtrace,
                token,
            ) {
                eprintln!("Ticketry could not stage panic attribution: {error}");
            }
        }
        previous(panic);
    }));
}

fn crash_attribution(panic: &std::panic::PanicHookInfo<'_>) -> Option<PendingAttribution> {
    let panic_message = panic_message(panic);
    let non_unwind_abort = is_non_unwind_abort(panic, &panic_message);
    let mut current = Some(PendingAttribution {
        panic_message,
        rust_backtrace: Backtrace::force_capture().to_string(),
    });
    PANIC_STATE.with(|state| {
        let mut previous = state.borrow_mut();
        let scope = previous
            .as_ref()
            .filter(|state| state.scope == RecoveryScope::ExplicitCatch)
            .map(|state| state.scope)
            .unwrap_or_else(|| {
                tokio::task::try_id()
                    .map(RecoveryScope::TokioTask)
                    .unwrap_or_else(|| {
                        if INSTALLING_THREAD
                            .get()
                            .is_some_and(|id| *id != std::thread::current().id())
                        {
                            RecoveryScope::ThreadRoot
                        } else {
                            RecoveryScope::ProcessRoot
                        }
                    })
            });
        let hook_count = previous
            .as_ref()
            .filter(|state| state.scope == scope)
            .map_or(1, |state| state.hook_count.saturating_add(1));
        let first_attribution = previous
            .as_mut()
            .filter(|state| state.scope == scope)
            .and_then(|state| state.first_attribution.take());
        let attribution = match hook_count {
            1 if scope == RecoveryScope::ProcessRoot => current.take(),
            1 => None,
            2 if non_unwind_abort => first_attribution,
            2 => current.take(),
            _ => None,
        };
        *previous = Some(PanicState {
            scope,
            hook_count,
            first_attribution: if hook_count == 1 && attribution.is_none() {
                current
            } else {
                None
            },
        });
        attribution
    })
}

fn is_non_unwind_abort(panic: &std::panic::PanicHookInfo<'_>, panic_message: &str) -> bool {
    panic_message == "panic in a function that cannot unwind"
        && panic
            .location()
            .is_some_and(|location| location.file().ends_with("library/core/src/panicking.rs"))
}

fn explicit_catch_scope() -> Option<PanicState> {
    PANIC_STATE.with(|state| {
        state.borrow_mut().replace(PanicState {
            scope: RecoveryScope::ExplicitCatch,
            hook_count: 0,
            first_attribution: None,
        })
    })
}

fn restore_panic_scope(previous: Option<PanicState>) {
    PANIC_STATE.with(|state| *state.borrow_mut() = previous);
}

/// Catch a panic without attributing a recovered unwind to a later crash.
pub fn catch_unwind_without_crash_attribution<F, R>(work: F) -> std::thread::Result<R>
where
    F: FnOnce() -> R + UnwindSafe,
{
    let previous = explicit_catch_scope();
    let result = std::panic::catch_unwind(work);
    restore_panic_scope(previous);
    result
}

fn stage(
    marker_path: &Path,
    attribution_path: &Path,
    panic_message: String,
    rust_backtrace: String,
    staging_token: u64,
) -> Result<(), String> {
    let _guard = STAGING_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if staging_token <= LAST_COMMITTED_SEQUENCE.load(Ordering::Relaxed) {
        return Ok(());
    }
    let marker_bytes = fs::read(marker_path)
        .map_err(|error| format!("could not read {}: {error}", marker_path.display()))?;
    let marker = serde_json::from_slice::<SessionIdentity>(&marker_bytes)
        .map_err(|error| format!("could not read {}: {error}", marker_path.display()))?;
    let attribution = PanicAttribution {
        session_id: marker.session_id,
        panic_message,
        rust_backtrace,
    };
    write_private_json(attribution_path, &attribution)?;
    LAST_COMMITTED_SEQUENCE.store(staging_token, Ordering::Relaxed);
    Ok(())
}

fn panic_message(panic: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(message) = panic.payload().downcast_ref::<&str>() {
        (*message).to_owned()
    } else if let Some(message) = panic.payload().downcast_ref::<String>() {
        message.clone()
    } else {
        "Rust panic with a non-string payload".to_owned()
    }
}

fn write_private_json(path: &Path, value: &PanicAttribution) -> Result<(), String> {
    let temporary_path = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .map_err(|error| format!("could not open {}: {error}", temporary_path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not protect {}: {error}", temporary_path.display()))?;
    }
    serde_json::to_writer_pretty(&mut file, value)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not finish {}: {error}", temporary_path.display()))?;
    fs::rename(&temporary_path, path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        format!(
            "could not replace {} with {}: {error}",
            path.display(),
            temporary_path.display()
        )
    })
}

fn attribution_path(data_directory: &Path) -> PathBuf {
    data_directory.join(PANIC_ATTRIBUTION_FILE)
}

#[cfg(debug_assertions)]
pub fn force_development_panic_abort() -> ! {
    let _ = std::panic::catch_unwind(|| {
        panic!("forced development panic-abort");
    });
    std::process::abort();
}
