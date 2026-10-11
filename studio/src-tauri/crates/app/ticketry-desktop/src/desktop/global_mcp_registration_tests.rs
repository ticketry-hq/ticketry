use super::*;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn packaged_context(directory: &std::path::Path) -> GlobalMcpStartupContext {
    GlobalMcpStartupContext {
        hook_runner: directory.join("ticketry-hook"),
        data_directory: directory.join("product"),
        claude_config_file: Some(directory.join(".claude.json")),
        codex_config_file: Some(directory.join("config.toml")),
        claude_executable: Some(std::env::current_exe().unwrap()),
        codex_executable: Some(std::env::current_exe().unwrap()),
        packaged_app: true,
        development_build: false,
        data_directory_overrides: [false; 4],
    }
}

#[test]
fn packaged_startup_registers_codex_alongside_claude() {
    let directory = tempfile::tempdir().unwrap();
    let context = packaged_context(directory.path());
    let (tx, rx) = mpsc::channel();
    GlobalMcpStartupRegistration::default().start(context, move |event| {
        tx.send(event).unwrap();
    });
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5)).unwrap().provider,
        "claude"
    );
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        GlobalMcpStartupEvent {
            provider: "codex",
            outcome: "registered",
            reason: None,
        }
    );
    let config = std::fs::read_to_string(directory.path().join("config.toml")).unwrap();
    assert!(config.contains("[mcp_servers.ticketry]"));
    assert!(config.contains("--global"));
}

#[test]
fn global_mcp_registration_runs_once_without_waiting_for_worker_completion() {
    // [overhaul-791] Packaged startup returns while provider registration is still active.
    let directory = tempfile::tempdir().unwrap();
    let context = packaged_context(directory.path());
    let config_file = context.claude_config_file.clone().unwrap();
    let codex_config_file = context.codex_config_file.clone().unwrap();
    let startup = GlobalMcpStartupRegistration::default();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = std::sync::Mutex::new(release_rx);
    let started = Instant::now();
    startup.start(context.clone(), move |event| {
        entered_tx.send(event).unwrap();
        let _ = release_rx
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2));
    });
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        GlobalMcpStartupEvent {
            provider: "claude",
            outcome: "registered",
            reason: None
        }
    );
    let registered = std::fs::read(&config_file).unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&registered).unwrap()["mcpServers"]["ticketry"]
            ["args"][3],
        "--global"
    );
    release_tx.send(()).unwrap();
    assert_eq!(
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        GlobalMcpStartupEvent {
            provider: "codex",
            outcome: "registered",
            reason: None
        }
    );
    std::fs::write(&config_file, b"{\"second_start_must_preserve\":true}").unwrap();
    std::fs::write(&codex_config_file, b"# second start must preserve\n").unwrap();
    let (repeated_tx, repeated_rx) = mpsc::channel();
    startup.start(context, move |event| {
        repeated_tx.send(event).unwrap();
    });
    assert_eq!(
        repeated_rx.recv_timeout(Duration::from_secs(5)),
        Err(mpsc::RecvTimeoutError::Disconnected)
    );
    release_tx.send(()).unwrap();
    assert_eq!(
        std::fs::read(&config_file).unwrap(),
        b"{\"second_start_must_preserve\":true}"
    );
    assert_eq!(
        std::fs::read(&codex_config_file).unwrap(),
        b"# second start must preserve\n"
    );
}

#[test]
fn global_mcp_registration_skips_debug_and_every_data_directory_override() {
    // [overhaul-792] Development startup never edits the user's provider configuration.
    for mode in 0..6 {
        let directory = tempfile::tempdir().unwrap();
        let mut context = packaged_context(directory.path());
        let config_file = context.claude_config_file.clone().unwrap();
        let codex_config_file = context.codex_config_file.clone().unwrap();
        std::fs::write(&config_file, b"{\"existing\":true}").unwrap();
        std::fs::write(&codex_config_file, b"# existing Codex settings\n").unwrap();
        if mode == 0 {
            context.packaged_app = false;
        } else if mode == 1 {
            context.development_build = true;
        } else {
            context.data_directory_overrides[mode - 2] = true;
        }
        let (tx, rx) = mpsc::channel();
        GlobalMcpStartupRegistration::default().start(context, move |event| {
            tx.send(event).unwrap();
        });
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            GlobalMcpStartupEvent {
                provider: "claude",
                outcome: "skipped",
                reason: Some("development_instance")
            }
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            GlobalMcpStartupEvent {
                provider: "codex",
                outcome: "skipped",
                reason: Some("development_instance")
            }
        );
        assert_eq!(std::fs::read(config_file).unwrap(), b"{\"existing\":true}");
        assert_eq!(
            std::fs::read(codex_config_file).unwrap(),
            b"# existing Codex settings\n"
        );
    }
}

#[test]
fn global_mcp_registration_reports_safe_failure_and_foreign_entry_reasons() {
    for (contents, lock, outcome, reason) in [
        (
            b"{\"api_key\":\"do-not-log-this-secret\"}".as_slice(),
            true,
            "failed",
            "locked",
        ),
        (
            b"not-json-do-not-log-this-secret".as_slice(),
            false,
            "failed",
            "invalid_state",
        ),
        (
            br#"{"mcpServers":{"ticketry":{"command":"custom-provider","env":{"SECRET":"do-not-log-this-secret"}}}}"#.as_slice(),
            false,
            "skipped",
            "foreign_entry",
        ),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let context = packaged_context(directory.path());
        let config_file = context.claude_config_file.clone().unwrap();
        std::fs::write(&config_file, contents).unwrap();
        if lock {
            std::fs::create_dir(directory.path().join(".claude.json.lock")).unwrap();
        }
        let (tx, rx) = mpsc::channel();
        GlobalMcpStartupRegistration::default().start(context, move |event| {
            tx.send(event).unwrap();
        });
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event, GlobalMcpStartupEvent {
            provider: "claude", outcome, reason: Some(reason)
        });
        assert!(!format!("{event:?}").contains("do-not-log-this-secret"));
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            GlobalMcpStartupEvent {
                provider: "codex",
                outcome: "registered",
                reason: None
            }
        );
        assert_eq!(std::fs::read(config_file).unwrap(), contents);
    }
}

#[test]
fn codex_registration_reports_safe_failure_and_foreign_entry_reasons() {
    for (contents, lock, outcome, reason) in [
        (
            b"# do-not-log-this-secret\n".as_slice(),
            true,
            "failed",
            "locked",
        ),
        (
            b"invalid-toml-do-not-log-this-secret".as_slice(),
            false,
            "failed",
            "invalid_state",
        ),
        (
            b"[mcp_servers.ticketry]\ncommand = 'custom-provider'\n[mcp_servers.ticketry.env]\nSECRET = 'do-not-log-this-secret'\n".as_slice(),
            false,
            "skipped",
            "foreign_entry",
        ),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let context = packaged_context(directory.path());
        let config_file = context.codex_config_file.clone().unwrap();
        std::fs::write(&config_file, contents).unwrap();
        if lock {
            std::fs::create_dir(directory.path().join("config.toml.lock")).unwrap();
        }
        let (tx, rx) = mpsc::channel();
        GlobalMcpStartupRegistration::default().start(context, move |event| {
            tx.send(event).unwrap();
        });
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            GlobalMcpStartupEvent {
                provider: "claude",
                outcome: "registered",
                reason: None
            }
        );
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event, GlobalMcpStartupEvent {
            provider: "codex", outcome, reason: Some(reason)
        });
        assert!(!format!("{event:?}").contains("do-not-log-this-secret"));
        assert_eq!(std::fs::read(config_file).unwrap(), contents);
    }
}
