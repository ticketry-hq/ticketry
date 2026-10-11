#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;

use ticketry_codex_app_server::CodexAppServerClient;
use toml_edit::DocumentMut;

const CHILD_TEST: &str = "isolated_public_client";

#[test]
fn disables_existing_stdio_and_http_servers_with_quoted_names() {
    run_isolated(
        Some(concat!(
            "# Keep user configuration untouched\n",
            "[mcp_servers.ticketry]\ncommand = 'ticketry-hook'\n",
            "[mcp_servers.'docs.api']\nurl = 'http://127.0.0.1:1/mcp'\n",
            "[mcp_servers.'quoted\"name']\ncommand = 'other-hook'\n",
        )),
        "existing",
        false,
    );
}

#[test]
fn accepts_absent_or_empty_user_configuration_without_inventing_a_server() {
    run_isolated(None, "empty", false);
    run_isolated(Some("model = 'example'\n"), "empty", false);
}

#[test]
fn honours_home_fallback_without_changing_the_child_environment() {
    run_isolated(None, "empty", true);
    run_isolated(
        Some(concat!(
            "[mcp_servers.ticketry]\ncommand = 'ticketry-hook'\n",
            "[mcp_servers.'docs.api']\nurl = 'http://127.0.0.1:1/mcp'\n",
            "[mcp_servers.'quoted\"name']\ncommand = 'other-hook'\n",
        )),
        "existing",
        true,
    );
}

#[test]
fn refuses_malformed_or_unreadable_configuration_before_spawning() {
    for config in [
        "private_key = 'test-secret'\n[malformed",
        "mcp_servers = 'unsupported'\n",
        "[mcp_servers]\nticketry = 'unsupported'\n",
    ] {
        run_isolated(Some(config), "error", false);
    }
    run_isolated(None, "error-directory", false);
}

fn run_isolated(config: Option<&str>, mode: &str, home_fallback: bool) {
    let directory = tempfile::tempdir().expect("create isolated Codex home");
    let codex_home = if home_fallback {
        directory.path().join(".codex")
    } else {
        directory.path().join("custom-codex")
    };
    fs::create_dir(&codex_home).unwrap();
    let config_path = codex_home.join("config.toml");
    if let Some(config) = config {
        fs::write(&config_path, config).unwrap();
    } else if mode == "error-directory" {
        fs::create_dir(&config_path).unwrap();
    }
    let executable = directory.path().join("codex");
    fs::write(
        &executable,
        concat!(
            "#!/bin/sh\n",
            "printf '%s\\n' \"$@\" > \"$TICKETRY_TEST_APP_SERVER_ARGUMENTS\"\n",
            "printf '%s\\n' \"$CODEX_HOME\" > \"$TICKETRY_TEST_APP_SERVER_HOME\"\n",
            "IFS= read -r request\n",
            "printf '{\"id\":1,\"result\":{}}\\n'\n",
            "while IFS= read -r request; do :; done\n",
        ),
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let arguments = directory.path().join("arguments");
    let observed_home = directory.path().join("observed-home");
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", CHILD_TEST, "--ignored", "--nocapture"])
        .env("HOME", directory.path())
        .env("TICKETRY_TEST_APP_SERVER_EXECUTABLE", &executable)
        .env("TICKETRY_TEST_APP_SERVER_ARGUMENTS", &arguments)
        .env("TICKETRY_TEST_APP_SERVER_HOME", &observed_home)
        .env("TICKETRY_TEST_APP_SERVER_MODE", mode);
    if home_fallback {
        command.env_remove("CODEX_HOME");
    } else {
        command.env("CODEX_HOME", &codex_home);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    if let Some(config) = config {
        assert_eq!(fs::read_to_string(config_path).unwrap(), config);
    } else if mode == "error-directory" {
        assert!(config_path.is_dir());
    } else {
        assert!(!config_path.exists());
    }
    if mode.starts_with("error") {
        assert!(!arguments.exists(), "unsafe helper must not be spawned");
        return;
    }
    let observed_home = fs::read_to_string(observed_home).unwrap();
    assert_eq!(
        observed_home.trim(),
        if home_fallback {
            ""
        } else {
            codex_home.to_str().unwrap()
        },
    );
}

#[tokio::test]
#[ignore = "invoked by parent tests with isolated process environment"]
async fn isolated_public_client() {
    let executable = std::env::var_os("TICKETRY_TEST_APP_SERVER_EXECUTABLE").unwrap();
    let mode = std::env::var("TICKETRY_TEST_APP_SERVER_MODE").unwrap();
    let result = CodexAppServerClient::start(executable).await;
    if mode.starts_with("error") {
        assert!(
            result.is_err(),
            "malformed config must fail before spawning"
        );
        assert!(!result.err().unwrap().to_string().contains("test-secret"));
        return;
    }
    let _client = result.expect("start isolated public client");
    let arguments =
        fs::read_to_string(std::env::var_os("TICKETRY_TEST_APP_SERVER_ARGUMENTS").unwrap())
            .unwrap();
    let arguments = arguments.lines().collect::<Vec<_>>();
    assert_eq!(
        &arguments[..4],
        ["app-server", "--stdio", "-c", "mcp_servers={}"]
    );
    if mode == "empty" {
        assert_eq!(arguments.len(), 4);
        return;
    }
    assert_eq!(arguments.len(), 6, "configured MCP names must be disabled");
    assert_eq!(arguments[4], "-c");
    let override_document = arguments[5].parse::<DocumentMut>().unwrap();
    let servers = override_document["mcp_servers"].as_table_like().unwrap();
    assert_eq!(servers.len(), 3);
    for name in ["ticketry", "docs.api", "quoted\"name"] {
        let server = servers.get(name).unwrap();
        assert_eq!(server["enabled"].as_bool(), Some(false));
        assert_eq!(server.as_table_like().unwrap().len(), 1);
    }
}
