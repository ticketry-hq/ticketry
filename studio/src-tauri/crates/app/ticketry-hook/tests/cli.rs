use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn invalid_mcp_modes_exit_with_usage_error_before_connecting() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener =
        std::os::unix::net::UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    listener.set_nonblocking(true).unwrap();
    for mode in [
        vec![],
        vec!["--global", "--agent-run-id", "run-123"],
        vec!["--agent-run-id", "run-123", "--global"],
        vec!["--global", "--agent-run-id"],
        vec!["--agent-run-id", "--global"],
        vec!["--agent-run-id", ""],
        vec!["--agent-run-id", "../escape"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
            .args(["mcp", "--data-dir", directory.path().to_str().unwrap()])
            .args(&mode)
            .env("TICKETRY_MCP_AUTHORIZATION", "Bearer unused-secret")
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "mode: {mode:?}");
        assert!(output.stdout.is_empty());
        let diagnostic = String::from_utf8_lossy(&output.stderr);
        assert!(diagnostic.contains("mcp requires"), "{diagnostic}");
        assert!(!diagnostic.contains("unused-secret"));
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[test]
fn run_mode_without_authorization_never_connects_as_global() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener =
        std::os::unix::net::UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    listener.set_nonblocking(true).unwrap();
    for authorization in [None, Some("")] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"));
        command
            .args([
                "mcp",
                "--data-dir",
                directory.path().to_str().unwrap(),
                "--agent-run-id",
                "run-123",
            ])
            .env_remove("TICKETRY_MCP_AUTHORIZATION");
        if let Some(authorization) = authorization {
            command.env("TICKETRY_MCP_AUTHORIZATION", authorization);
        }
        let output = command.output().unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr)
            .contains("TICKETRY_MCP_AUTHORIZATION is required"));
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[test]
fn mcp_help_succeeds_without_a_credential() {
    let output = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args(["mcp", "--help"])
        .env_remove("TICKETRY_MCP_AUTHORIZATION")
        .output()
        .expect("run ticketry-hook");

    assert!(output.status.success());
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.contains("--data-dir"));
    assert!(help.contains("--global"));
    assert!(help.contains("exactly one"));
    assert!(output.stderr.is_empty());
}

#[test]
fn global_mode_help_succeeds_without_data_or_authorization() {
    let output = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args(["mcp", "--global", "--help"])
        .env_remove("TICKETRY_MCP_AUTHORIZATION")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Global authority"));
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
