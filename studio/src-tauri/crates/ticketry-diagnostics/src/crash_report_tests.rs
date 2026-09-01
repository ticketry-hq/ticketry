use std::fs;
use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};

use super::*;

fn instant(second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, second)
        .single()
        .expect("test instant")
}

/// A libghostty crash database that is never created. Collection treats a
/// missing database as no record, so every case below exercises the shutdown
/// collector without one; `native_minidump_report` owns the cases with one.
fn absent_sentry_database() -> PathBuf {
    std::env::temp_dir().join("ticketry-absent-libghostty-sentry-database")
}

/// Shadows the collector under test with its arity before libghostty crash
/// records were collected, so each case names only what it stages.
fn collect_dirty_shutdown(
    data_directory: &Path,
    diagnostic_reports_directory: &Path,
    event_log_path: Option<&Path>,
    clock: impl FnOnce() -> DateTime<Utc>,
) -> Option<PathBuf> {
    super::collect_dirty_shutdown(
        data_directory,
        diagnostic_reports_directory,
        &absent_sentry_database(),
        event_log_path,
        clock,
    )
}

fn sidecar(report: &Path) -> serde_json::Value {
    let bytes = fs::read(report.join(SIDECAR_FILE)).expect("read sidecar");
    serde_json::from_slice(&bytes).expect("parse sidecar")
}

fn current_session_id(data: &Path) -> String {
    let bytes = fs::read(data.join(SESSION_MARKER_FILE)).expect("read Session Marker");
    serde_json::from_slice::<serde_json::Value>(&bytes).expect("parse Session Marker")["session_id"]
        .as_str()
        .expect("Session Marker identity")
        .to_owned()
}

fn stage_panic(data: &Path, session_id: &str, message: &str, backtrace: &str) {
    let attribution = serde_json::json!({
        "session_id": session_id,
        "panic_message": message,
        "rust_backtrace": backtrace,
    });
    fs::write(
        data.join("panic-attribution.json"),
        serde_json::to_vec_pretty(&attribution).expect("serialize panic attribution"),
    )
    .expect("stage panic attribution");
}

fn stage_native_report(
    diagnostic_reports_directory: &Path,
    file_name: &str,
    app_name: &str,
    bundle_id: Option<&str>,
    report_timestamp: &str,
    capture_time: &str,
) -> Vec<u8> {
    let mut header = serde_json::json!({
        "app_name": app_name,
        "name": app_name,
        "timestamp": report_timestamp,
    });
    if let Some(bundle_id) = bundle_id {
        header["bundleID"] = bundle_id.into();
    }
    let mut body = serde_json::json!({
        "captureTime": capture_time,
        "procName": app_name,
        "threads": [],
    });
    if let Some(bundle_id) = bundle_id {
        body["bundleInfo"] = serde_json::json!({
            "CFBundleIdentifier": bundle_id,
        });
    }
    let contents = format!(
        "{}\n{}\n",
        serde_json::to_string(&header).expect("serialize native report header"),
        serde_json::to_string(&body).expect("serialize native report body"),
    )
    .into_bytes();
    fs::write(diagnostic_reports_directory.join(file_name), &contents)
        .expect("stage native report");
    contents
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
fn native_report_lookup_failure_keeps_the_marker_only_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = data.path().join("not-a-diagnostic-reports-directory");
    fs::write(&native, b"not a directory").expect("block native reports directory");
    collect_dirty_shutdown(data.path(), &native, None, || instant(0));

    let report = collect_dirty_shutdown(data.path(), &native, None, || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
}

#[test]
fn matching_native_report_is_copied_and_referenced_by_the_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let native_file = "Ticketry-2026-08-31-100000.500.ips";
    let expected = stage_native_report(
        native.path(),
        native_file,
        "Ticketry",
        Some("com.ticketry.desktop"),
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 10:00:00.500 +0000",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("Crash Report with native report");

    assert_eq!(
        fs::read(report.join(native_file)).expect("copied native report"),
        expected
    );
    assert_eq!(sidecar(&report)["native_report"], native_file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(report.join(native_file))
                .expect("native report metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn process_identity_matches_a_macos_report_that_omits_the_bundle_id() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let native_file = "ticketry-2026-08-31-153000.500.ips";
    stage_native_report(
        native.path(),
        native_file,
        "ticketry",
        None,
        "2026-08-31 15:30:00.500 +0530",
        "2026-08-31 15:30:00.500 +0530",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("Crash Report with process-matched native report");

    assert!(report.join(native_file).is_file());
    assert_eq!(sidecar(&report)["native_report"], native_file);
}

#[test]
fn report_generation_time_cannot_pull_an_old_crash_into_the_session_window() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let native_file = "ticketry-2026-08-31-100000.500.ips";
    stage_native_report(
        native.path(),
        native_file,
        "ticketry",
        None,
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 09:59:59.900 +0000",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(!report.join(native_file).exists());
}

#[test]
fn foreign_and_out_of_window_native_reports_are_not_collected() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    let foreign_file = "OtherApp-2026-08-31-100000.500.ips";
    let foreign_bundle_file = "ticketry-foreign-bundle.ips";
    let old_ticketry_file = "Ticketry-2026-08-31-095959.ips";
    stage_native_report(
        native.path(),
        foreign_file,
        "OtherApp",
        Some("com.example.other"),
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 10:00:00.500 +0000",
    );
    stage_native_report(
        native.path(),
        foreign_bundle_file,
        "ticketry",
        Some("com.example.other"),
        "2026-08-31 10:00:00.600 +0000",
        "2026-08-31 10:00:00.600 +0000",
    );
    stage_native_report(
        native.path(),
        old_ticketry_file,
        "Ticketry",
        Some("com.ticketry.desktop"),
        "2026-08-31 09:59:59.000 +0000",
        "2026-08-31 09:59:59.000 +0000",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(!report.join(foreign_file).exists());
    assert!(!report.join(foreign_bundle_file).exists());
    assert!(!report.join(old_ticketry_file).exists());
}

#[test]
fn panic_attribution_is_folded_into_the_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    stage_panic(
        data.path(),
        &current_session_id(data.path()),
        "forced development panic-abort",
        "stack backtrace:\n   0: ticketry::desktop::run",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("panic-attributed Crash Report");
    let sidecar = sidecar(&report);

    assert_eq!(sidecar["dirty_exit_reason"], "panic");
    assert_eq!(sidecar["panic_message"], "forced development panic-abort");
    assert_eq!(
        sidecar["rust_backtrace"],
        "stack backtrace:\n   0: ticketry::desktop::run"
    );
}

#[test]
fn stale_panic_attribution_is_not_applied_to_a_non_panic_dirty_shutdown() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    stage_panic(
        data.path(),
        "an-earlier-session",
        "old panic",
        "old backtrace",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("non-panic Crash Report");
    let sidecar = sidecar(&report);

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
}

#[test]
fn partial_panic_staging_does_not_suppress_a_non_panic_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), None, || instant(0));
    fs::write(data.path().join("panic-attribution.json"), b"{")
        .expect("write partial panic staging");

    let report = collect_dirty_shutdown(data.path(), native.path(), None, || instant(1))
        .expect("non-panic Crash Report");
    let sidecar = sidecar(&report);

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
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
