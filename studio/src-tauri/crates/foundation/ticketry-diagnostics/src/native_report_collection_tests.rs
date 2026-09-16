use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, TimeZone, Utc};

use super::*;

const APP_VERSION: &str = "9.8.7";
const COMMIT: &str = "0123456789abcdef";

fn instant(second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, second)
        .single()
        .expect("test instant")
}

fn collect_dirty_shutdown(
    data_directory: &Path,
    diagnostic_reports_directory: &Path,
    clock: impl FnOnce() -> DateTime<Utc>,
) -> Option<PathBuf> {
    super::collect_dirty_shutdown(
        data_directory,
        diagnostic_reports_directory,
        None,
        APP_VERSION,
        COMMIT,
        clock,
    )
}

fn sidecar(report: &Path) -> serde_json::Value {
    let bytes = fs::read(report.join(SIDECAR_FILE)).expect("read sidecar");
    serde_json::from_slice(&bytes).expect("parse sidecar")
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
fn immediate_relaunch_collects_a_native_report_that_macos_publishes_later() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));

    let report = collect_dirty_shutdown(data.path(), native.path(), || instant(1))
        .expect("marker-only Crash Report");
    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);

    let native_file = "Ticketry-2026-08-31-100000.500.ips";
    let expected = stage_native_report(
        native.path(),
        native_file,
        "Ticketry",
        Some("com.ticketry.desktop"),
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 10:00:00.500 +0000",
    );

    for _ in 0..100 {
        if sidecar(&report)["native_report"] == native_file {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    assert_eq!(sidecar(&report)["native_report"], native_file);
    assert_eq!(
        fs::read(report.join(native_file)).expect("delayed native report copy"),
        expected
    );
}

#[test]
fn breakpad_envelope_is_not_exported() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    let sentry = tempfile::tempdir().expect("sentry database directory");
    fs::write(sentry.path().join("last_crash"), instant(0).to_rfc3339())
        .expect("stage Breakpad crash marker");
    let run = sentry.path().join("test.run");
    fs::create_dir(&run).expect("stage Breakpad run");
    fs::write(
        run.join("crash.envelope"),
        b"event.minidump\nraw process memory",
    )
    .expect("stage Breakpad envelope");
    fs::write(
        native.path().join("crash.envelope"),
        b"event.minidump\nraw process memory",
    )
    .expect("stage non-native report");
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));

    let report =
        collect_dirty_shutdown(data.path(), native.path(), || instant(1)).expect("Crash Report");
    let sidecar = sidecar(&report);

    assert_eq!(sidecar["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(sidecar.get("libghostty_report").is_none());
    assert_eq!(report.read_dir().expect("read Crash Report").count(), 1);
}

#[test]
fn native_report_lookup_failure_keeps_the_marker_only_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = data.path().join("not-a-diagnostic-reports-directory");
    fs::write(&native, b"not a directory").expect("block native reports directory");
    collect_dirty_shutdown(data.path(), &native, || instant(0));

    let report = collect_dirty_shutdown(data.path(), &native, || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
}

#[test]
fn matching_native_report_is_copied_and_referenced_by_the_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));
    let native_file = "Ticketry-2026-08-31-100000.500.ips";
    let expected = stage_native_report(
        native.path(),
        native_file,
        "Ticketry",
        Some("com.ticketry.desktop"),
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 10:00:00.500 +0000",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), || instant(1))
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
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));
    let native_file = "ticketry-2026-08-31-153000.500.ips";
    stage_native_report(
        native.path(),
        native_file,
        "ticketry",
        None,
        "2026-08-31 15:30:00.500 +0530",
        "2026-08-31 15:30:00.500 +0530",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), || instant(1))
        .expect("Crash Report with process-matched native report");

    assert!(report.join(native_file).is_file());
    assert_eq!(sidecar(&report)["native_report"], native_file);
}

#[test]
fn report_generation_time_cannot_pull_an_old_crash_into_the_session_window() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));
    let native_file = "ticketry-2026-08-31-100000.500.ips";
    stage_native_report(
        native.path(),
        native_file,
        "ticketry",
        None,
        "2026-08-31 10:00:00.500 +0000",
        "2026-08-31 09:59:59.900 +0000",
    );

    let report = collect_dirty_shutdown(data.path(), native.path(), || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(!report.join(native_file).exists());
}

#[test]
fn foreign_and_out_of_window_native_reports_are_not_collected() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    collect_dirty_shutdown(data.path(), native.path(), || instant(0));
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

    let report = collect_dirty_shutdown(data.path(), native.path(), || instant(1))
        .expect("marker-only Crash Report");

    assert_eq!(sidecar(&report)["native_report"], NATIVE_REPORT_NOT_FOUND);
    assert!(!report.join(foreign_file).exists());
    assert!(!report.join(foreign_bundle_file).exists());
    assert!(!report.join(old_ticketry_file).exists());
}
