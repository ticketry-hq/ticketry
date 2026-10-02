#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use super::probe::version_probe;

fn probe_script(root: &std::path::Path, script: &str) -> std::path::PathBuf {
    let path = root.join("gh");
    fs::write(&path, script).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[test]
fn times_out_inherited_pipes_and_kills_the_helper() {
    let root = tempfile::tempdir().unwrap();
    let path = probe_script(root.path(),
        "#!/bin/sh\n(/bin/sleep 3; printf leaked > \"$0.leaked\") &\nprintf 'gh version 2.96.0\n'\nexit 0\n");
    let start = Instant::now();
    assert_eq!(
        version_probe(&path, "--version").unwrap_err(),
        "version probe timed out"
    );
    assert!(start.elapsed() < Duration::from_secs(3));
    std::thread::sleep(Duration::from_millis(1500));
    assert!(
        !path.with_extension("leaked").exists(),
        "probe helper survived cleanup"
    );
}

#[test]
fn drains_both_streams_while_the_probe_runs() {
    let root = tempfile::tempdir().unwrap();
    let path = probe_script(root.path(),
        "#!/bin/sh\nprintf 'gh version 2.96.0\n'\n/usr/bin/head -c 262144 /dev/zero\n/usr/bin/head -c 262144 /dev/zero >&2\n");
    let output = version_probe(&path, "--version").unwrap();
    assert!(output.starts_with("gh version 2.96.0"));
    assert_eq!(output.len(), 64 * 1024);
}

#[test]
fn bounds_a_directly_stalled_probe() {
    let root = tempfile::tempdir().unwrap();
    let path = probe_script(root.path(), "#!/bin/sh\nexec /bin/sleep 10\n");
    let start = Instant::now();
    assert_eq!(
        version_probe(&path, "--version").unwrap_err(),
        "version probe timed out"
    );
    assert!(start.elapsed() < Duration::from_secs(3));
}
