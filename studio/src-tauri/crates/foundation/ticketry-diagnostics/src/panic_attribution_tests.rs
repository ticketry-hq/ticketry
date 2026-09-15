use std::fs;

use chrono::{TimeZone, Utc};

const APP_VERSION: &str = "9.8.7";
const COMMIT: &str = "0123456789abcdef";
const CHILD_DATA_DIRECTORY: &str = "TICKETRY_CAUGHT_PANIC_TEST_DATA_DIRECTORY";
const DOUBLE_PANIC_DATA_DIRECTORY: &str = "TICKETRY_DOUBLE_PANIC_TEST_DATA_DIRECTORY";
const EXTERN_C_PANIC_DATA_DIRECTORY: &str = "TICKETRY_EXTERN_C_PANIC_TEST_DATA_DIRECTORY";
#[cfg(debug_assertions)]
const FORCED_PANIC_DATA_DIRECTORY: &str = "TICKETRY_FORCED_PANIC_TEST_DATA_DIRECTORY";
const THREAD_PANIC_DATA_DIRECTORY: &str = "TICKETRY_THREAD_PANIC_TEST_DATA_DIRECTORY";
const TOKIO_PANIC_DATA_DIRECTORY: &str = "TICKETRY_TOKIO_PANIC_TEST_DATA_DIRECTORY";

#[cfg(debug_assertions)]
#[test]
fn forced_panic_abort_is_attributed_by_the_collector() {
    if let Some(data_directory) = std::env::var_os(FORCED_PANIC_DATA_DIRECTORY) {
        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        super::force_development_panic_abort();
    }

    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );

    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .arg("panic_attribution_tests::forced_panic_abort_is_attributed_by_the_collector")
        .arg("--exact")
        .env(FORCED_PANIC_DATA_DIRECTORY, data.path())
        .status()
        .expect("run forced-panic child");
    assert!(!status.success(), "the forced panic must abort the child");

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("panic-attributed Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert_eq!(sidecar["dirty_exit_reason"], "panic");
    assert_eq!(sidecar["panic_message"], "forced development panic-abort");
    assert!(sidecar["rust_backtrace"]
        .as_str()
        .is_some_and(|backtrace| !backtrace.is_empty()));
}

#[test]
fn caught_panic_survives_and_does_not_taint_a_later_hard_death() {
    if let Some(data_directory) = std::env::var_os(CHILD_DATA_DIRECTORY) {
        let data_directory = std::path::Path::new(&data_directory);
        super::install_panic_attribution_hook(data_directory);
        assert!(super::catch_unwind_without_crash_attribution(|| {
            panic!("caught worker panic")
        })
        .is_err());
        fs::write(data_directory.join("caught-panic-returned"), []).expect("record recovery");
        std::process::abort();
    }

    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );

    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .arg("panic_attribution_tests::caught_panic_survives_and_does_not_taint_a_later_hard_death")
        .arg("--exact")
        .env(CHILD_DATA_DIRECTORY, data.path())
        .status()
        .expect("run caught-panic child");
    assert!(
        !status.success(),
        "the later hard death must stop the child"
    );
    assert!(
        data.path().join("caught-panic-returned").is_file(),
        "catch_unwind must return before the unrelated hard death"
    );

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("non-panic Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
}

#[test]
fn recovered_thread_root_panic_does_not_taint_a_later_hard_death() {
    if let Some(data_directory) = std::env::var_os(THREAD_PANIC_DATA_DIRECTORY) {
        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        let thread = std::thread::spawn(|| panic!("recovered thread-root panic"));
        assert!(thread.join().is_err(), "thread root must recover the panic");
        fs::write(std::path::Path::new(&data_directory).join("recovered"), [])
            .expect("record recovery");
        std::process::abort();
    }

    assert_recovered_panic_does_not_taint_later_abort(
        THREAD_PANIC_DATA_DIRECTORY,
        "panic_attribution_tests::recovered_thread_root_panic_does_not_taint_a_later_hard_death",
    );
}

#[test]
fn recovered_tokio_task_panic_does_not_taint_a_later_hard_death() {
    if let Some(data_directory) = std::env::var_os(TOKIO_PANIC_DATA_DIRECTORY) {
        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("Tokio runtime")
            .block_on(async {
                let error = tokio::spawn(async { panic!("recovered Tokio task panic") })
                    .await
                    .expect_err("Tokio must report the task panic");
                assert!(error.is_panic());
            });
        fs::write(std::path::Path::new(&data_directory).join("recovered"), [])
            .expect("record recovery");
        std::process::abort();
    }

    assert_recovered_panic_does_not_taint_later_abort(
        TOKIO_PANIC_DATA_DIRECTORY,
        "panic_attribution_tests::recovered_tokio_task_panic_does_not_taint_a_later_hard_death",
    );
}

fn assert_recovered_panic_does_not_taint_later_abort(environment: &str, test_name: &str) {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );

    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .arg(test_name)
        .arg("--exact")
        .env(environment, data.path())
        .status()
        .expect("run recovered-panic child");
    assert!(
        !status.success(),
        "the later hard death must stop the child"
    );
    assert!(
        data.path().join("recovered").is_file(),
        "the runtime boundary must recover before the unrelated hard death"
    );

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("non-panic Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
}

#[test]
fn earlier_session_panic_is_not_applied_to_a_non_panic_dirty_shutdown() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );
    fs::write(
        data.path().join("panic-attribution.json"),
        br#"{"session_id":"earlier","panic_message":"old","rust_backtrace":"old"}"#,
    )
    .expect("stage earlier panic");

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("non-panic Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
}

#[test]
fn partial_panic_staging_does_not_suppress_a_non_panic_crash_report() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );
    fs::write(data.path().join("panic-attribution.json"), b"{")
        .expect("stage partial panic attribution");

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("non-panic Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert!(sidecar.get("dirty_exit_reason").is_none());
    assert!(sidecar.get("panic_message").is_none());
    assert!(sidecar.get("rust_backtrace").is_none());
}

#[test]
fn double_panic_during_recovery_keeps_the_crash_ending_panic() {
    if let Some(data_directory) = std::env::var_os(DOUBLE_PANIC_DATA_DIRECTORY) {
        struct PanicDuringUnwind;

        impl Drop for PanicDuringUnwind {
            fn drop(&mut self) {
                panic!("crash-ending panic during unwind");
            }
        }

        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        let _ = super::catch_unwind_without_crash_attribution(|| {
            let _panic_during_unwind = PanicDuringUnwind;
            panic!("initial recovered panic");
        });
        std::process::exit(86);
    }

    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );

    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .arg("panic_attribution_tests::double_panic_during_recovery_keeps_the_crash_ending_panic")
        .arg("--exact")
        .env(DOUBLE_PANIC_DATA_DIRECTORY, data.path())
        .status()
        .expect("run double-panic child");
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        assert_eq!(status.signal(), Some(6), "the double panic must SIGABRT");
    }
    #[cfg(not(unix))]
    assert!(!status.success(), "the double panic must abort the child");

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("panic-attributed Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert_eq!(sidecar["dirty_exit_reason"], "panic");
    assert_eq!(sidecar["panic_message"], "crash-ending panic during unwind");
    assert!(sidecar["rust_backtrace"]
        .as_str()
        .is_some_and(|backtrace| !backtrace.is_empty()));
}

#[test]
fn non_unwinding_panic_keeps_the_application_message() {
    if let Some(data_directory) = std::env::var_os(EXTERN_C_PANIC_DATA_DIRECTORY) {
        extern "C" fn panic_across_non_unwind_boundary() {
            panic!("application panic across extern C boundary");
        }

        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        std::thread::spawn(|| panic_across_non_unwind_boundary())
            .join()
            .expect("non-unwinding panic must abort before join returns");
    }

    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 0).unwrap(),
    );

    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .arg("panic_attribution_tests::non_unwinding_panic_keeps_the_application_message")
        .arg("--exact")
        .env(EXTERN_C_PANIC_DATA_DIRECTORY, data.path())
        .status()
        .expect("run non-unwinding-panic child");
    assert!(!status.success(), "the non-unwinding panic must abort");

    let report = super::collect_dirty_shutdown(
        data.path(),
        native.path(),
        None,
        APP_VERSION,
        COMMIT,
        || Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, 1).unwrap(),
    )
    .expect("panic-attributed Crash Report");
    let sidecar: serde_json::Value =
        serde_json::from_slice(&fs::read(report.join("crash-report.json")).expect("read sidecar"))
            .expect("parse sidecar");

    assert_eq!(sidecar["dirty_exit_reason"], "panic");
    assert_eq!(
        sidecar["panic_message"],
        "application panic across extern C boundary"
    );
    assert!(sidecar["rust_backtrace"]
        .as_str()
        .is_some_and(|backtrace| !backtrace.is_empty()));
}
