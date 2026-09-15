use std::fs;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use chrono::{TimeZone, Utc};

use super::*;

#[test]
fn startup_does_not_wait_for_pending_native_report_scans() {
    let data = tempfile::tempdir().expect("data directory");
    let native = tempfile::tempdir().expect("diagnostic reports directory");
    let instant = |second| {
        Utc.with_ymd_and_hms(2026, 8, 31, 10, 0, second)
            .single()
            .expect("test instant")
    };
    let pending = data
        .path()
        .join(CRASH_REPORTS_DIRECTORY)
        .join("crash-report-pending");
    fs::create_dir_all(&pending).expect("create pending Crash Report");
    let sidecar_path = pending.join(SIDECAR_FILE);
    let sidecar = serde_json::to_vec_pretty(&serde_json::json!({
        "app_version": "9.8.7",
        "commit": "0123456789abcdef",
        "os": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "session_started_at": instant(0),
        "session_ended_at": instant(1),
        "native_report": NATIVE_REPORT_NOT_FOUND,
    }))
    .expect("serialize pending sidecar");
    fs::write(&sidecar_path, &sidecar).expect("stage pending sidecar");
    fs::remove_file(&sidecar_path).expect("remove sidecar");
    assert!(Command::new("mkfifo")
        .arg(&sidecar_path)
        .status()
        .expect("create FIFO")
        .success());
    fs::write(
        native.path().join("Ticketry-2026-08-31-100000.500.ips"),
        concat!(
            "{\"app_name\":\"Ticketry\",\"bundleID\":\"com.ticketry.desktop\",",
            "\"name\":\"Ticketry\",\"timestamp\":\"2026-08-31 10:00:00.500 +0000\"}\n",
            "{\"bundleInfo\":{\"CFBundleIdentifier\":\"com.ticketry.desktop\"},",
            "\"captureTime\":\"2026-08-31 10:00:00.500 +0000\",",
            "\"procName\":\"Ticketry\",\"threads\":[]}\n"
        ),
    )
    .expect("stage delayed native report");

    let data_path = data.path().to_owned();
    let native_path = native.path().to_owned();
    let (returned_tx, returned_rx) = mpsc::channel();
    let collector = std::thread::spawn(move || {
        collect_dirty_shutdown(
            &data_path,
            &native_path,
            None,
            "9.8.7",
            "0123456789abcdef",
            || instant(2),
        );
        returned_tx.send(()).expect("startup result");
    });

    let returned = returned_rx.recv_timeout(Duration::from_secs(5));
    let writer_path = sidecar_path.clone();
    let (written_tx, written_rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        written_tx
            .send(fs::write(writer_path, sidecar))
            .expect("FIFO write result");
    });
    written_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("retry worker did not read pending sidecar")
        .expect("unblock pending scan");
    writer.join().expect("FIFO writer");
    collector.join().expect("collector thread");
    for _ in 0..500 {
        if sidecar_path.is_file() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    returned.expect("startup blocked on pending scan");
    assert!(sidecar_path.is_file());
    assert!(pending.join("Ticketry-2026-08-31-100000.500.ips").is_file());
}
