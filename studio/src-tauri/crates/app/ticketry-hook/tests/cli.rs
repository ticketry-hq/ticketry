use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn mcp_help_succeeds_without_a_credential() {
    let output = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args(["mcp", "--help"])
        .env_remove("TICKETRY_MCP_AUTHORIZATION")
        .output()
        .expect("run ticketry-hook");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("--data-dir"));
    assert!(output.stderr.is_empty());
}

#[test]
fn hook_spools_the_raw_payload_and_keeps_failures_silent() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args([
            "hook",
            "codex",
            "--agent-run-id",
            "run-123",
            "--spool-dir",
            directory.path().to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"SessionStart"}"#)
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
    let entry = std::fs::read_dir(directory.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        std::fs::read(entry).unwrap(),
        br#"{"hook_event_name":"SessionStart"}"#
    );

    let output = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args([
            "hook",
            "codex",
            "--agent-run-id",
            "../escape",
            "--spool-dir",
            "/tmp",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}
