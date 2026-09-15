//! Opt-in provider contract: cargo test -p ticketry-launch --test gemini_directory_trust -- --ignored --nocapture
use std::{
    fs,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};
use ticketry_launch::{DirectoryTrustOutcome, DirectoryTrustSetup, Provider};

fn git(directory: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(directory)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
#[ignore = "requires installed Gemini CLI and Node; uses disposable provider configuration"]
fn installed_gemini_connects_mcp_after_explicit_folder_setup() {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("home");
    let module = root.path().join("module");
    let worktree = root.path().join("data/worktrees/module/first-grill");
    fs::create_dir_all(home.join(".gemini")).unwrap();
    fs::create_dir_all(&module).unwrap();
    git(&module, &["init", "-q"]);
    git(
        &module,
        &[
            "-c",
            "user.name=Acceptance",
            "-c",
            "user.email=acceptance@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "initial",
        ],
    );
    git(
        &module,
        &[
            "worktree",
            "add",
            "-qb",
            "first-grill",
            worktree.to_str().unwrap(),
        ],
    );
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/trust_mcp.mjs");
    let settings = serde_json::json!({
        "security": {"folderTrust": {"enabled": true}},
        "mcpServers": {"trust-probe": {"command": "node", "args": [fixture], "timeout": 3000}}
    });
    fs::write(home.join(".gemini/settings.json"), settings.to_string()).unwrap();
    let trust = home.join(".gemini/trustedFolders.json");
    let provider = std::env::var("TICKETRY_TEST_GEMINI").unwrap_or("gemini".into());
    let run = |cwd: &Path, args: &[&str]| {
        let capture = tempfile::NamedTempFile::new().unwrap();
        let mut child = Command::new(&provider)
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", &home)
            .env("GEMINI_CLI_HOME", &home)
            .env("GEMINI_CLI_TRUSTED_FOLDERS_PATH", &trust)
            .env("GEMINI_CLI_SYSTEM_SETTINGS_PATH", home.join("system.json"))
            .env(
                "GEMINI_CLI_SYSTEM_DEFAULTS_PATH",
                home.join("defaults.json"),
            )
            .env("NO_COLOR", "1")
            .stdin(std::process::Stdio::null())
            .stdout(capture.as_file().try_clone().unwrap())
            .stderr(capture.as_file().try_clone().unwrap())
            .spawn()
            .expect("installed Gemini CLI must run");
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Gemini timed out after 30 seconds: {args:?}");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let text = fs::read_to_string(capture.path()).unwrap();
        if args.first() != Some(&"-p") {
            assert!(status.success(), "{text}");
        }
        eprintln!("CWD={} args={args:?}\n{text}", cwd.display());
        text
    };
    run(&module, &["--version"]);
    let setup = DirectoryTrustSetup::new(Provider::Gemini, trust.clone());
    assert!(run(&module, &["mcp", "list"]).contains("folder is untrusted"));
    assert_eq!(
        setup.prepare(&module, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    let connected = run(&module, &["mcp", "list"]);
    assert!(
        connected.contains("Connected") && !connected.contains("untrusted"),
        "{connected}"
    );
    let startup = run(
        &module,
        &[
            "-p",
            "Selected workflow prompt: Grill. Ask the first clarification question.",
        ],
    );
    assert!(
        startup.contains("Please set an Auth method") && !startup.contains("folder is untrusted"),
        "{startup}"
    );
    // An external worktree requires its own explicit approval, matching its actual CWD.
    assert!(run(&worktree, &["mcp", "list"]).contains("folder is untrusted"));
    assert_eq!(
        setup.prepare(&worktree, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    let connected = run(&worktree, &["mcp", "list"]);
    assert!(
        connected.contains("Connected") && !connected.contains("untrusted"),
        "{connected}"
    );
    // Startup reaches the isolated authentication boundary; no model request is made.
    let startup = run(
        &worktree,
        &[
            "-p",
            "Selected workflow prompt: Grill. Ask the first clarification question.",
        ],
    );
    assert!(
        startup.contains("Please set an Auth method") && !startup.contains("folder is untrusted"),
        "{startup}"
    );
}
