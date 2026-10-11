use std::path::Path;

use ticketry_provider::{
    register_claude_global_mcp, GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};

fn register(config: &Path, hook: &Path, data: &Path) -> GlobalMcpRegistrationOutcome {
    register_claude_global_mcp(GlobalMcpRegistrationContext {
        hook_runner: hook,
        data_directory: data,
        config_file: Some(config),
        executable: Some(Path::new("/bin/sh")),
    })
}

#[test]
fn registers_the_exact_secret_free_user_scope_entry() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("claude/.claude.json");
    assert_eq!(
        register(
            &config,
            Path::new("/Applications/Ticketry.app/ticketry-hook"),
            Path::new("/Users/test/Ticketry")
        ),
        GlobalMcpRegistrationOutcome::Registered
    );
    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(config).unwrap()).unwrap();
    assert_eq!(
        state,
        serde_json::json!({
            "mcpServers": {
                "ticketry": {
                    "command": "/Applications/Ticketry.app/ticketry-hook",
                    "args": ["mcp", "--data-dir", "/Users/test/Ticketry", "--global"]
                }
            }
        })
    );
}

#[test]
fn a_second_registration_leaves_identical_bytes() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let hook = Path::new("/app/ticketry-hook");
    let data = Path::new("/product/data");
    assert_eq!(
        register(&config, hook, data),
        GlobalMcpRegistrationOutcome::Registered
    );
    let before = std::fs::read(&config).unwrap();
    assert_eq!(
        register(&config, hook, data),
        GlobalMcpRegistrationOutcome::Unchanged
    );
    assert_eq!(std::fs::read(&config).unwrap(), before);
}

#[test]
fn a_moved_application_repairs_its_owned_command_path() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let data = Path::new("/product/data");
    register(&config, Path::new("/old/Ticketry.app/ticketry-hook"), data);
    assert_eq!(
        register(&config, Path::new("/new/Ticketry.app/ticketry-hook"), data),
        GlobalMcpRegistrationOutcome::Updated
    );
    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(config).unwrap()).unwrap();
    assert_eq!(
        state["mcpServers"]["ticketry"]["command"],
        "/new/Ticketry.app/ticketry-hook"
    );
}

#[test]
fn preserves_projects_unrelated_keys_and_other_mcp_servers() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let original = serde_json::json!({
        "oauthAccount": {"emailAddress": "preserve@example.com"},
        "theme": "dark",
        "projects": {"/work/project": {"hasTrustDialogAccepted": true, "allowedTools": ["Read"]}},
        "mcpServers": {"docs": {"command": "docs-server", "args": ["--flag"], "env": {"TOKEN": "preserved-only"}}}
    });
    std::fs::write(&config, serde_json::to_vec(&original).unwrap()).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Registered
    );
    let mut after: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    after["mcpServers"]
        .as_object_mut()
        .unwrap()
        .remove("ticketry");
    assert_eq!(after, original);
}

#[test]
fn leaves_user_authored_and_unrecognisable_ticketry_entries_untouched() {
    for entry in [
        serde_json::json!({"command": "/custom/server", "args": ["mcp", "--global"]}),
        serde_json::json!({"command": "/app/ticketry-hook", "args": ["mcp", "--agent-run-id", "run"]}),
        serde_json::json!({"command": "/app/ticketry-hook", "args": ["--global"]}),
        serde_json::json!({"command": "/app/ticketry-hook-other", "args": ["mcp", "--global"]}),
        serde_json::json!({"command": "/app/ticketry-hook", "args": "mcp --global"}),
        serde_json::Value::Null,
    ] {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join(".claude.json");
        let before =
            serde_json::to_vec(&serde_json::json!({"mcpServers": {"ticketry": entry}})).unwrap();
        std::fs::write(&config, &before).unwrap();
        assert_eq!(
            register(
                &config,
                Path::new("/app/ticketry-hook"),
                Path::new("/product/data")
            ),
            GlobalMcpRegistrationOutcome::Skipped {
                reason: "foreign_entry".into()
            }
        );
        assert_eq!(std::fs::read(&config).unwrap(), before);
    }
}

#[test]
fn skips_without_creating_a_config_tree_when_claude_is_absent() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("absent/.claude.json");
    let missing_cli = root.path().join("no-claude");
    assert_eq!(
        register_claude_global_mcp(GlobalMcpRegistrationContext {
            hook_runner: Path::new("/app/ticketry-hook"),
            data_directory: Path::new("/product/data"),
            config_file: Some(&config),
            executable: Some(&missing_cli),
        }),
        GlobalMcpRegistrationOutcome::Skipped {
            reason: "provider_not_installed".into()
        }
    );
    assert!(!config.parent().unwrap().exists());
}

#[test]
fn malformed_or_unsupported_state_is_untouched_without_panicking() {
    for before in [
        "{ malformed secret-token",
        "[]",
        r#"{"projects": []}"#,
        r#"{"projects": {"relative": {}}}"#,
        r#"{"projects": {"/work": {"hasTrustDialogAccepted": "yes"}}}"#,
        r#"{"mcpServers": null}"#,
        r#"{"mcpServers": []}"#,
        r#"{"mcpServers": "secret-token"}"#,
    ] {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join(".claude.json");
        std::fs::write(&config, before).unwrap();
        assert!(matches!(
            register(
                &config,
                Path::new("/app/ticketry-hook"),
                Path::new("/product/data")
            ),
            GlobalMcpRegistrationOutcome::Failed { .. }
        ));
        assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
    }
}

#[test]
fn relative_paths_are_rejected_before_creating_configuration() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("claude/.claude.json");
    for (hook, data) in [
        (Path::new("ticketry-hook"), Path::new("/product/data")),
        (Path::new("/app/ticketry-hook"), Path::new("relative-data")),
    ] {
        assert!(matches!(
            register(&config, hook, data),
            GlobalMcpRegistrationOutcome::Failed { .. }
        ));
        assert!(!config.parent().unwrap().exists());
    }
}

#[test]
fn a_root_configuration_path_is_rejected_without_panicking() {
    assert_eq!(
        register(
            Path::new("/"),
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Failed {
            diagnostic: "configuration_path_unavailable".into()
        }
    );
}

#[cfg(unix)]
#[test]
fn non_utf8_paths_are_rejected_without_writing_or_panicking() {
    use std::os::unix::ffi::OsStrExt;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("claude/.claude.json");
    let non_utf8 = Path::new(std::ffi::OsStr::from_bytes(b"/bad-\xff/ticketry-hook"));
    for (hook, data) in [
        (non_utf8, Path::new("/product/data")),
        (Path::new("/app/ticketry-hook"), non_utf8),
    ] {
        assert!(matches!(
            register(&config, hook, data),
            GlobalMcpRegistrationOutcome::Failed { .. }
        ));
        assert!(!config.parent().unwrap().exists());
    }
}

#[test]
fn repairs_owned_shape_and_product_directory_without_carrying_secrets() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "mcpServers": {"ticketry": {
                "command": "/app/ticketry-hook",
                "args": ["mcp", "--data-dir", "/old-product/data", "--global"],
                "env": {"TICKETRY_MCP_AUTHORIZATION": "old-secret"},
                "cwd": "/old-working-dir",
                "required": true,
                "timeout": 123
            }}
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/new-product/data")
        ),
        GlobalMcpRegistrationOutcome::Updated
    );
    let state: serde_json::Value = serde_json::from_slice(&std::fs::read(config).unwrap()).unwrap();
    assert_eq!(
        state["mcpServers"]["ticketry"],
        serde_json::json!({
            "command": "/app/ticketry-hook",
            "args": ["mcp", "--data-dir", "/new-product/data", "--global"]
        })
    );
}

#[test]
fn existing_state_registers_even_if_claude_cannot_be_resolved() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let missing_cli = root.path().join("no-claude");
    std::fs::write(&config, "{}").unwrap();
    assert_eq!(
        register_claude_global_mcp(GlobalMcpRegistrationContext {
            hook_runner: Path::new("/app/ticketry-hook"),
            data_directory: Path::new("/product/data"),
            config_file: Some(&config),
            executable: Some(&missing_cli),
        }),
        GlobalMcpRegistrationOutcome::Registered
    );
}

#[test]
fn a_locked_state_is_untouched_and_reports_a_safe_diagnostic() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let before = r#"{"oauthAccount": {"token": "preserved-secret"}}"#;
    std::fs::write(&config, before).unwrap();
    std::fs::create_dir(root.path().join(".claude.json.lock")).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Failed {
            diagnostic: "locked".into()
        }
    );
    assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
    assert!(root.path().join(".claude.json.lock").is_dir());
}

#[cfg(unix)]
#[test]
fn a_symlinked_state_file_and_its_target_are_untouched() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join(".claude.json");
    let target = root.path().join("actual-state.json");
    std::fs::write(&target, "{}").unwrap();
    std::os::unix::fs::symlink(&target, &config).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Failed {
            diagnostic: "invalid_state".into()
        }
    );
    assert_eq!(std::fs::read_link(&config).unwrap(), target);
    assert_eq!(std::fs::read_to_string(target).unwrap(), "{}");
}
