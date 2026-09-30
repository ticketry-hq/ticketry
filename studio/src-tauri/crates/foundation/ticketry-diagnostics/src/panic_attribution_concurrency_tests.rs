use std::fs;

use chrono::{TimeZone, Utc};

const APP_VERSION: &str = "9.8.7";
const COMMIT: &str = "0123456789abcdef";
const CONCURRENT_PANIC_DATA_DIRECTORY: &str = "TICKETRY_CONCURRENT_PANIC_TEST_DATA_DIRECTORY";
const REVERSE_CONCURRENT_PANIC_DATA_DIRECTORY: &str =
    "TICKETRY_REVERSE_CONCURRENT_PANIC_TEST_DATA_DIRECTORY";

#[test]
fn concurrent_recovered_panic_keeps_the_earlier_crash_ending_panic() {
    if let Some(data_directory) = std::env::var_os(CONCURRENT_PANIC_DATA_DIRECTORY) {
        let staged = std::sync::Arc::new(std::sync::Barrier::new(2));
        let release = std::sync::Arc::new(std::sync::Barrier::new(2));
        let hook_staged = staged.clone();
        let hook_release = release.clone();
        std::panic::set_hook(Box::new(move |panic| {
            if panic.payload().downcast_ref::<&str>().copied() == Some("earlier crash-ending panic")
            {
                hook_staged.wait();
                hook_release.wait();
                std::process::abort();
            }
        }));
        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        std::thread::spawn(|| {
            struct CrashEndingPanic;
            impl Drop for CrashEndingPanic {
                fn drop(&mut self) {
                    panic!("earlier crash-ending panic");
                }
            }
            let _crash_ending_panic = CrashEndingPanic;
            panic!("recovered thread-root panic");
        });
        staged.wait();
        assert!(
            super::catch_unwind_without_crash_attribution(|| { panic!("later caught panic") })
                .is_err()
        );
        release.wait();
        loop {
            std::thread::park();
        }
    }

    assert_subprocess_attribution(
        CONCURRENT_PANIC_DATA_DIRECTORY,
        "panic_attribution_concurrency_tests::concurrent_recovered_panic_keeps_the_earlier_crash_ending_panic",
        "earlier crash-ending panic",
    );
}

#[test]
fn concurrent_recovered_panic_keeps_the_newer_crash_ending_panic() {
    if let Some(data_directory) = std::env::var_os(REVERSE_CONCURRENT_PANIC_DATA_DIRECTORY) {
        let caught_staged = std::sync::Arc::new(std::sync::Barrier::new(2));
        let caught_release = std::sync::Arc::new(std::sync::Barrier::new(2));
        let fatal_staged = std::sync::Arc::new(std::sync::Barrier::new(2));
        let fatal_release = std::sync::Arc::new(std::sync::Barrier::new(2));
        let hook_caught_staged = caught_staged.clone();
        let hook_caught_release = caught_release.clone();
        let hook_fatal_staged = fatal_staged.clone();
        let hook_fatal_release = fatal_release.clone();
        std::panic::set_hook(Box::new(move |panic| {
            match panic.payload().downcast_ref::<&str>().copied() {
                Some("earlier caught panic") => {
                    hook_caught_staged.wait();
                    hook_caught_release.wait();
                }
                Some("newer crash-ending panic") => {
                    hook_fatal_staged.wait();
                    hook_fatal_release.wait();
                    std::process::abort();
                }
                _ => {}
            }
        }));
        super::install_panic_attribution_hook(std::path::Path::new(&data_directory));
        let caught = std::thread::spawn(|| {
            assert!(super::catch_unwind_without_crash_attribution(|| {
                panic!("earlier caught panic")
            })
            .is_err());
        });
        caught_staged.wait();
        std::thread::spawn(|| {
            struct CrashEndingPanic;
            impl Drop for CrashEndingPanic {
                fn drop(&mut self) {
                    panic!("newer crash-ending panic");
                }
            }
            let _crash_ending_panic = CrashEndingPanic;
            panic!("recovered thread-root panic");
        });
        fatal_staged.wait();
        caught_release.wait();
        caught.join().expect("caught panic must recover");
        fatal_release.wait();
        loop {
            std::thread::park();
        }
    }

    assert_subprocess_attribution(
        REVERSE_CONCURRENT_PANIC_DATA_DIRECTORY,
        "panic_attribution_concurrency_tests::concurrent_recovered_panic_keeps_the_newer_crash_ending_panic",
        "newer crash-ending panic",
    );
}

fn assert_subprocess_attribution(environment: &str, test_name: &str, panic_message: &str) {
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
        .expect("run concurrent-panic child");
    assert!(
        !status.success(),
        "the crash-ending panic must abort the child"
    );

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
    assert_eq!(sidecar["panic_message"], panic_message);
    assert!(sidecar["rust_backtrace"]
        .as_str()
        .is_some_and(|backtrace| !backtrace.is_empty()));
}
