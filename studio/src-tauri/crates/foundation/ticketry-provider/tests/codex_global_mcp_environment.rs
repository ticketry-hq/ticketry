use std::{path::Path, process::Command};

use ticketry_provider::{
    register_codex_global_mcp, GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};

/// Isolated subprocess environments avoid mutating HOME or CODEX_HOME in the
/// parallel test runner. Existing configs register even with no resolved CLI.
#[test]
fn user_scope_honours_codex_home_and_home_fallback() {
    if let Some(expected) = std::env::var_os("TICKETRY_TEST_CODEX_EXPECTED_CONFIG") {
        assert_eq!(
            register_codex_global_mcp(GlobalMcpRegistrationContext {
                hook_runner: Path::new("/app/ticketry-hook"),
                data_directory: Path::new("/product/data"),
                config_file: None,
                executable: Some(Path::new("/missing/codex")),
            }),
            GlobalMcpRegistrationOutcome::Registered
        );
        let document = std::fs::read_to_string(expected)
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert_eq!(
            document["mcp_servers"]["ticketry"]["command"].as_str(),
            Some("/app/ticketry-hook")
        );
        return;
    }
    for codex_home in [Some("custom"), Some(""), None] {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let custom = root.path().join("custom-codex");
        let use_custom = codex_home == Some("custom");
        let expected = if use_custom {
            custom.join("config.toml")
        } else {
            home.join(".codex/config.toml")
        };
        std::fs::create_dir_all(expected.parent().unwrap()).unwrap();
        std::fs::write(&expected, "model = 'preserved'\n").unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "user_scope_honours_codex_home_and_home_fallback"])
            .env("HOME", &home)
            .env("TICKETRY_TEST_CODEX_EXPECTED_CONFIG", &expected);
        match codex_home {
            Some("custom") => {
                command.env("CODEX_HOME", &custom);
            }
            Some("") => {
                command.env("CODEX_HOME", "");
            }
            _ => {
                command.env_remove("CODEX_HOME");
            }
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let untouched = if use_custom {
            home.join(".codex")
        } else {
            custom
        };
        assert!(!untouched.exists());
    }
}

#[cfg(unix)]
#[test]
fn an_installed_codex_on_path_creates_its_missing_configuration() {
    use std::os::unix::fs::PermissionsExt;
    if let Some(expected) = std::env::var_os("TICKETRY_TEST_CODEX_PATH_CONFIG") {
        assert_eq!(
            register_codex_global_mcp(GlobalMcpRegistrationContext {
                hook_runner: Path::new("/app/ticketry-hook"),
                data_directory: Path::new("/product/data"),
                config_file: None,
                executable: None,
            }),
            GlobalMcpRegistrationOutcome::Registered
        );
        assert!(Path::new(&expected).is_file());
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let executable = root.path().join("codex");
    std::fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let codex_home = root.path().join("codex-home");
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "an_installed_codex_on_path_creates_its_missing_configuration",
        ])
        .env("PATH", root.path())
        .env("CODEX_HOME", &codex_home)
        .env(
            "TICKETRY_TEST_CODEX_PATH_CONFIG",
            codex_home.join("config.toml"),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
