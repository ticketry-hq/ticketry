use std::fs;
use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};

use super::*;

fn instant(second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, second)
        .single()
        .expect("test instant")
}

fn sidecar(report: &Path) -> serde_json::Value {
    let bytes = fs::read(report.join(SIDECAR_FILE)).expect("read sidecar");
    serde_json::from_slice(&bytes).expect("parse sidecar")
}

#[test]
fn clean_exit_leaves_no_marker_and_next_launch_produces_no_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");

    assert!(collect_dirty_shutdown(data.path(), native.path(), None, || instant(0)).is_none());
    assert!(data.path().join(SESSION_MARKER_FILE).is_file());

    clean_session_marker(data.path()).expect("clean exit");
    assert!(!data.path().join(SESSION_MARKER_FILE).exists());

    assert!(collect_dirty_shutdown(data.path(), native.path(), None, || instant(1)).is_none());
    let reports = data.path().join(CRASH_REPORTS_DIRECTORY);
    assert!(!reports.exists() || reports.read_dir().expect("read reports").next().is_none());
}

#[test]
fn stale_marker_produces_complete_sidecar_without_a_native_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("Crash Report");
    let sidecar = sidecar(&report);

    assert_eq!(sidecar["app_version"], env!("CARGO_PKG_VERSION"));
    assert!(sidecar["commit"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert_eq!(sidecar["os"], std::env::consts::OS);
    assert_eq!(sidecar["architecture"], std::env::consts::ARCH);
    assert_eq!(
        sidecar["session_started_at"],
        serde_json::to_value(instant(0)).expect("serialize start")
    );
    assert_eq!(
        sidecar["session_ended_at"],
        serde_json::to_value(instant(1)).expect("serialize end")
    );
    assert_eq!(sidecar["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(sidecar.get("event_log_tail").is_none());
}

#[test]
fn event_log_tail_is_bounded_and_only_present_when_file_logging_was_enabled() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    let log = data.path().join("ticketry.log");
    let contents = (0..250)
        .map(|line| format!("event-{line:03}"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&log, contents).expect("write event log");

    collect_dirty_shutdown(data.path(), native.path(), Some(&log), || instant(0));
    let enabled = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("Crash Report with log");
    let enabled_sidecar = sidecar(&enabled);
    let tail = enabled_sidecar["event_log_tail"]
        .as_array()
        .expect("event log tail");
    assert_eq!(tail.len(), EVENT_LOG_LINE_LIMIT);
    assert_eq!(tail.first().expect("first tail line"), "event-050");
    assert_eq!(tail.last().expect("last tail line"), "event-249");

    let disabled = collect_dirty_shutdown(data.path(), native.path(), None, || instant(2))
        .expect("Crash Report without log");
    assert!(sidecar(&disabled).get("event_log_tail").is_none());
}

#[test]
fn eleventh_report_prunes_the_oldest() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let mut oldest = None;
    for second in 1..=11 {
        let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(second))
            .expect("Crash Report");
        oldest.get_or_insert(report);
    }

    let reports = data.path().join(CRASH_REPORTS_DIRECTORY);
    assert_eq!(reports.read_dir().expect("read reports").count(), 10);
    assert!(!oldest.expect("oldest report").exists());
}

#[test]
fn unwritable_report_location_does_not_stop_the_new_session() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    fs::write(
        data.path().join(CRASH_REPORTS_DIRECTORY),
        b"not a directory",
    )
    .expect("block reports directory");

    assert!(collect_dirty_shutdown(data.path(), native.path(), None, || instant(1)).is_none());
    assert!(data.path().join(SESSION_MARKER_FILE).is_file());
}

#[cfg(unix)]
#[test]
fn marker_and_sidecar_files_are_private() {
    use std::os::unix::fs::PermissionsExt;

    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let marker_mode = fs::metadata(data.path().join(SESSION_MARKER_FILE))
        .expect("marker metadata")
        .permissions()
        .mode()
        & 0o777;
    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("Crash Report");
    let sidecar_mode = fs::metadata(report.join(SIDECAR_FILE))
        .expect("sidecar metadata")
        .permissions()
        .mode()
        & 0o777;

    assert_eq!(marker_mode, 0o600);
    assert_eq!(sidecar_mode, 0o600);
}
