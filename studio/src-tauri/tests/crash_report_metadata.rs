use std::fs;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

fn launch(data_directory: &std::path::Path, home: &std::path::Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_ticketry"))
        .env("TICKETRY_DATA_DIR", data_directory)
        .env("HOME", home)
        .env_remove("TICKETRY_PRODUCT_DATA_DIR")
        .env_remove("MUXED_DATA_DIR")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("launch shipped Ticketry binary")
}

fn wait_for_json(
    child: &mut Child,
    mut read: impl FnMut() -> Option<serde_json::Value>,
) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Some(value) = read() {
            return value;
        }
        assert!(child
            .try_wait()
            .expect("inspect Ticketry process")
            .is_none());
        thread::sleep(Duration::from_millis(25));
    }
    child.kill().expect("stop timed-out Ticketry process");
    child.wait().expect("reap timed-out Ticketry process");
    panic!("Ticketry did not write crash metadata within ten seconds");
}

fn stop(child: &mut Child) {
    child.kill().expect("stop Ticketry process");
    child.wait().expect("reap Ticketry process");
}

#[test]
fn shipped_desktop_invocation_records_tauri_version_and_build_commit() {
    let data = tempfile::tempdir().expect("data directory");
    let home = tempfile::tempdir().expect("isolated home directory");

    let mut first = launch(data.path(), home.path());
    wait_for_json(&mut first, || {
        fs::read(data.path().join("session-marker.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    });
    stop(&mut first);

    let mut second = launch(data.path(), home.path());
    let sidecar = wait_for_json(&mut second, || {
        fs::read_dir(data.path().join("crash-reports"))
            .ok()?
            .filter_map(Result::ok)
            .find_map(|entry| fs::read(entry.path().join("crash-report.json")).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    });
    stop(&mut second);

    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("Tauri configuration");
    assert_eq!(sidecar["app_version"], config["version"]);
    assert!(!["", "unknown"].contains(&sidecar["commit"].as_str().unwrap_or_default().trim()));
}
