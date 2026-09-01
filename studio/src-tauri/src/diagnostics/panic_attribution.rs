use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const SESSION_MARKER_FILE: &str = "session-marker.json";
const PANIC_ATTRIBUTION_FILE: &str = "panic-attribution.json";

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

/// Record every panic, whichever panic strategy this build uses. Unwinding
/// builds still abort on panics that cross a `extern "C-unwind"` boundary, and
/// a recovered panic leaves an attribution that startup clears, so the hook is
/// installed unconditionally rather than only for panic-abort builds.
pub(crate) fn install_hook(data_directory: &Path) {
    let marker = data_directory.join(SESSION_MARKER_FILE);
    let attribution = attribution_path(data_directory);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let message = panic_message(panic);
        let rust_backtrace = Backtrace::force_capture().to_string();
        if let Err(error) = stage(&marker, &attribution, message, rust_backtrace) {
            eprintln!("Ticketry could not stage panic attribution: {error}");
        }
        previous(panic);
    }));
}

fn stage(
    marker_path: &Path,
    attribution_path: &Path,
    panic_message: String,
    rust_backtrace: String,
) -> Result<(), String> {
    let marker_bytes = fs::read(marker_path)
        .map_err(|error| format!("could not read {}: {error}", marker_path.display()))?;
    let marker = serde_json::from_slice::<SessionIdentity>(&marker_bytes)
        .map_err(|error| format!("could not read {}: {error}", marker_path.display()))?;
    let attribution = PanicAttribution {
        session_id: marker.session_id,
        panic_message,
        rust_backtrace,
    };
    write_private_json(attribution_path, &attribution)
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
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not protect {}: {error}", path.display()))?;
    }
    serde_json::to_writer_pretty(&mut file, value)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not finish {}: {error}", path.display()))
}

fn attribution_path(data_directory: &Path) -> PathBuf {
    data_directory.join(PANIC_ATTRIBUTION_FILE)
}

#[cfg(debug_assertions)]
pub(crate) fn force_development_panic_abort() -> ! {
    let _ = std::panic::catch_unwind(|| {
        panic!("forced development panic-abort");
    });
    std::process::abort();
}
