use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

const SESSION_MARKER_FILE: &str = "session-marker.json";
const CRASH_REPORTS_DIRECTORY: &str = "crash-reports";
const SIDECAR_FILE: &str = "crash-report.json";
const NATIVE_REPORT_NOT_FOUND: &str = "no native report found";
const EVENT_LOG_LINE_LIMIT: usize = 200;
const REPORT_RETENTION_LIMIT: usize = 10;

#[derive(Debug, Deserialize, Serialize)]
struct SessionMarker {
    app_version: String,
    commit: String,
    os: String,
    architecture: String,
    session_started_at: DateTime<Utc>,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dirty_exit_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_log_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
struct CrashReportSidecar {
    app_version: String,
    commit: String,
    os: String,
    architecture: String,
    session_started_at: DateTime<Utc>,
    session_ended_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dirty_exit_reason: Option<String>,
    native_report: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_log_tail: Option<Vec<String>>,
}

/// Collect a stale Session Marker, then mark the session that is starting now.
/// Errors are reported to stderr and never escape into desktop startup.
pub(crate) fn collect_dirty_shutdown(
    data_directory: &Path,
    diagnostic_reports_directory: &Path,
    event_log_path: Option<&Path>,
    clock: impl FnOnce() -> DateTime<Utc>,
) -> Option<PathBuf> {
    let now = clock();
    let report = match collect_stale_session(data_directory, diagnostic_reports_directory, now) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("Ticketry could not collect a Crash Report: {error}");
            None
        }
    };
    if let Err(error) = write_session_marker(data_directory, event_log_path, now) {
        eprintln!("Ticketry could not write its Session Marker: {error}");
    }
    report
}

pub(crate) fn clean_session_marker(data_directory: &Path) -> Result<(), String> {
    let marker = marker_path(data_directory);
    match fs::remove_file(&marker) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", marker.display())),
    }
}

pub(crate) fn system_diagnostic_reports_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("Library/Logs/DiagnosticReports")
}

fn collect_stale_session(
    data_directory: &Path,
    diagnostic_reports_directory: &Path,
    now: DateTime<Utc>,
) -> Result<Option<PathBuf>, String> {
    let marker_path = marker_path(data_directory);
    let marker = match fs::read(&marker_path) {
        Ok(bytes) => serde_json::from_slice::<SessionMarker>(&bytes)
            .map_err(|error| format!("could not read {}: {error}", marker_path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not read {}: {error}", marker_path.display())),
    };

    // Native report matching belongs to the dependent `.ips` slice. Keeping
    // this argument here preserves the one collector entry point.
    let _ = diagnostic_reports_directory;
    let event_log_tail = marker
        .event_log_path
        .as_deref()
        .map(read_event_log_tail)
        .transpose()?;
    let sidecar = CrashReportSidecar {
        app_version: marker.app_version,
        commit: marker.commit,
        os: marker.os,
        architecture: marker.architecture,
        session_started_at: marker.session_started_at,
        session_ended_at: now,
        dirty_exit_reason: marker.dirty_exit_reason,
        native_report: NATIVE_REPORT_NOT_FOUND,
        event_log_tail,
    };

    let reports_directory = data_directory.join(CRASH_REPORTS_DIRECTORY);
    create_private_directory(&reports_directory)?;
    let report_directory = reports_directory.join(format!(
        "crash-report-{}-{}",
        now.format("%Y%m%dT%H%M%S%.3fZ"),
        marker.session_id
    ));
    create_private_directory(&report_directory)?;
    if let Err(error) = write_private_json(&report_directory.join(SIDECAR_FILE), &sidecar) {
        let _ = fs::remove_dir(&report_directory);
        return Err(error);
    }
    fs::remove_file(&marker_path)
        .map_err(|error| format!("could not remove {}: {error}", marker_path.display()))?;
    prune_old_reports(&reports_directory)?;
    Ok(Some(report_directory))
}

fn write_session_marker(
    data_directory: &Path,
    event_log_path: Option<&Path>,
    now: DateTime<Utc>,
) -> Result<(), String> {
    fs::create_dir_all(data_directory).map_err(|error| {
        format!(
            "could not create data directory {}: {error}",
            data_directory.display()
        )
    })?;
    let marker = SessionMarker {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        commit: option_env!("TICKETRY_COMMIT")
            .unwrap_or("unknown")
            .to_owned(),
        os: std::env::consts::OS.to_owned(),
        architecture: std::env::consts::ARCH.to_owned(),
        session_started_at: now,
        session_id: uuid::Uuid::new_v4().simple().to_string(),
        dirty_exit_reason: None,
        event_log_path: event_log_path.map(Path::to_path_buf),
    };
    write_private_json(&marker_path(data_directory), &marker)
}

fn marker_path(data_directory: &Path) -> PathBuf {
    data_directory.join(SESSION_MARKER_FILE)
}

fn read_event_log_tail(path: &Path) -> Result<Vec<String>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("could not open {}: {error}", path.display())),
    };
    let mut tail = VecDeque::with_capacity(EVENT_LOG_LINE_LIMIT);
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("could not read {}: {error}", path.display()))?;
        if tail.len() == EVENT_LOG_LINE_LIMIT {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    Ok(tail.into())
}

fn prune_old_reports(reports_directory: &Path) -> Result<(), String> {
    let entries = fs::read_dir(reports_directory).map_err(|error| {
        format!(
            "could not list Crash Reports in {}: {error}",
            reports_directory.display()
        )
    })?;
    let mut reports = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .collect::<Vec<_>>();
    reports.sort_by_key(|entry| entry.file_name());
    let prune_count = reports.len().saturating_sub(REPORT_RETENTION_LIMIT);
    for entry in reports.into_iter().take(prune_count) {
        fs::remove_dir_all(entry.path()).map_err(|error| {
            format!(
                "could not prune old Crash Report {}: {error}",
                entry.path().display()
            )
        })?;
    }
    Ok(())
}

fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    #[cfg(unix)]
    set_private_file_permissions(path)?;
    serde_json::to_writer_pretty(&mut file, value)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not finish {}: {error}", path.display()))
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("could not protect {}: {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("could not protect {}: {error}", path.display()))
}

#[cfg(test)]
#[path = "crash_report_tests.rs"]
mod tests;
