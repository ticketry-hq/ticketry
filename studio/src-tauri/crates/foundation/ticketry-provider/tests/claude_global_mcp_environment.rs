use std::{path::Path, process::Command};

use ticketry_provider::{
    register_claude_global_mcp, GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};

/// Spawn this same public-API test with isolated environment variables, so tests
/// never mutate HOME or CLAUDE_CONFIG_DIR in the parallel test process.
#[test]
fn user_scope_honours_claude_config_dir_and_home_fallback() {
    if let Some(expected) = std::env::var_os("TICKETRY_TEST_CLAUDE_EXPECTED_CONFIG") {
        let expected = Path::new(&expected);
        assert_eq!(
            register_claude_global_mcp(GlobalMcpRegistrationContext {
                hook_runner: Path::new("/app/ticketry-hook"),
                data_directory: Path::new("/product/data"),
                config_file: None,
                executable: Some(Path::new("/missing/claude")),
            }),
            GlobalMcpRegistrationOutcome::Registered
        );
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(expected).unwrap()).unwrap();
        assert_eq!(
            state["mcpServers"]["ticketry"]["command"],
            "/app/ticketry-hook"
        );
        return;
    }

    for use_config_dir in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let config_dir = root.path().join("custom-claude");
        std::fs::create_dir(&home).unwrap();
        std::fs::create_dir(&config_dir).unwrap();
        let expected = if use_config_dir { &config_dir } else { &home }.join(".claude.json");
        std::fs::write(&expected, "{}").unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .arg("--exact")
            .arg("user_scope_honours_claude_config_dir_and_home_fallback")
            .env("HOME", &home)
            .env("TICKETRY_TEST_CLAUDE_EXPECTED_CONFIG", &expected);
        if use_config_dir {
            command.env("CLAUDE_CONFIG_DIR", &config_dir);
        } else {
            command.env_remove("CLAUDE_CONFIG_DIR");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let untouched = if use_config_dir { &home } else { &config_dir }.join(".claude.json");
        assert!(!untouched.exists());
    }
}
