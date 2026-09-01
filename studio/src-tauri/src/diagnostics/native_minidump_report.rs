//! Collection of libghostty's Breakpad crash record.
//!
//! libghostty statically links sentry-native with its Breakpad backend, and
//! Breakpad claims the process's Mach exception ports. A native fault anywhere
//! in libghostty therefore never reaches macOS's crash reporter and never
//! raises a signal: Breakpad writes a minidump and calls `_exit(1)`, so
//! `launchd` records an ordinary `exit(1)`, no `.ips` report is ever written,
//! and no Rust panic hook runs. Ticketry's Session Marker survives that exit,
//! so the next launch reports a dirty shutdown with nothing attached at all.
//!
//! Breakpad's envelope carries the crashing thread's stack, the loaded module
//! set, and the fault address. Copying it into the Crash Report is what makes
//! this class of death attributable (CODING-1368 investigation).

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

/// libghostty compiles Ghostty's own bundle identifier into its cache path, so
/// the database lives beside Ghostty's rather than under Ticketry's.
const GHOSTTY_BUNDLE_ID: &str = "com.mitchellh.ghostty";
const LAST_CRASH_FILE: &str = "last_crash";
const ENVELOPE_EXTENSION: &str = "envelope";
const COLLECTED_FILE_PREFIX: &str = "libghostty-crash";

/// Where libghostty's Breakpad backend keeps its crash database.
pub(crate) fn ghostty_sentry_database_directory() -> PathBuf {
    if let Some(cache) = std::env::var_os("XDG_CACHE_HOME") {
        return PathBuf::from(cache).join("ghostty/sentry");
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("Library/Caches")
        .join(GHOSTTY_BUNDLE_ID)
        .join("sentry")
}

/// Copies libghostty's crash record into the Crash Report when Breakpad
/// recorded a crash inside the session that just ended. Returns the copied
/// file's name.
pub(super) fn copy_matching_report(
    sentry_database_directory: &Path,
    crash_report_directory: &Path,
    session_started_at: DateTime<Utc>,
    session_ended_at: DateTime<Utc>,
) -> Result<Option<String>, String> {
    let Some(crashed_at) = last_crash_time(sentry_database_directory)? else {
        return Ok(None);
    };
    if crashed_at < session_started_at || crashed_at > session_ended_at {
        return Ok(None);
    }
    let Some(envelope) = newest_envelope(sentry_database_directory)? else {
        return Ok(None);
    };
    let file_name = format!(
        "{COLLECTED_FILE_PREFIX}-{}.{ENVELOPE_EXTENSION}",
        crashed_at.format("%Y%m%dT%H%M%S%.3fZ")
    );
    let destination = crash_report_directory.join(&file_name);
    fs::copy(&envelope, &destination).map_err(|error| {
        format!(
            "could not copy {} to {}: {error}",
            envelope.display(),
            destination.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not protect {}: {error}", destination.display()))?;
    }
    Ok(Some(file_name))
}

fn last_crash_time(sentry_database_directory: &Path) -> Result<Option<DateTime<Utc>>, String> {
    let path = sentry_database_directory.join(LAST_CRASH_FILE);
    let recorded = match fs::read_to_string(&path) {
        Ok(recorded) => recorded,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not read {}: {error}", path.display())),
    };
    // An unparseable marker is somebody else's data or an obsolete shape; it
    // never blocks the rest of Crash Report collection.
    Ok(DateTime::parse_from_rfc3339(recorded.trim())
        .ok()
        .map(|recorded| recorded.with_timezone(&Utc)))
}

/// Breakpad writes one envelope per crash into a per-run subdirectory. The
/// newest is the crash `last_crash` just dated.
fn newest_envelope(sentry_database_directory: &Path) -> Result<Option<PathBuf>, String> {
    let runs = match fs::read_dir(sentry_database_directory) {
        Ok(runs) => runs,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "could not list {}: {error}",
                sentry_database_directory.display()
            ));
        }
    };
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for run in runs.filter_map(Result::ok) {
        if !run.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Ok(envelopes) = fs::read_dir(run.path()) else {
            continue;
        };
        for envelope in envelopes.filter_map(Result::ok) {
            if envelope.path().extension().and_then(|value| value.to_str())
                != Some(ENVELOPE_EXTENSION)
            {
                continue;
            }
            let Ok(modified) = envelope.metadata().and_then(|data| data.modified()) else {
                continue;
            };
            if newest.as_ref().is_none_or(|(newest, _)| modified > *newest) {
                newest = Some((modified, envelope.path()));
            }
        }
    }
    Ok(newest.map(|(_, path)| path))
}

#[cfg(test)]
#[path = "native_minidump_report_tests.rs"]
mod tests;
