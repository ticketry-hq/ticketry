use std::path::Path;

use ticketry_provider::{
    register_codex_global_mcp, GlobalMcpRegistrationContext, GlobalMcpRegistrationOutcome,
};

fn register(config: &Path, hook: &Path, data: &Path) -> GlobalMcpRegistrationOutcome {
    register_codex_global_mcp(GlobalMcpRegistrationContext {
        hook_runner: hook,
        data_directory: data,
        config_file: Some(config),
        executable: Some(Path::new("/bin/sh")),
    })
}

#[test]
fn registers_the_exact_secret_free_optional_stdio_entry() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("codex/config.toml");
    assert_eq!(
        register(
            &config,
            Path::new("/Applications/Ticketry.app/ticketry-hook"),
            Path::new("/Users/test/Ticketry")
        ),
        GlobalMcpRegistrationOutcome::Registered
    );
    let document = std::fs::read_to_string(config)
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    let entry = document["mcp_servers"]["ticketry"].as_table_like().unwrap();
    assert_eq!(entry.len(), 2);
    assert_eq!(
        entry.get("command").unwrap().as_str(),
        Some("/Applications/Ticketry.app/ticketry-hook")
    );
    let args: Vec<_> = entry
        .get("args")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap())
        .collect();
    assert_eq!(
        args,
        ["mcp", "--data-dir", "/Users/test/Ticketry", "--global"]
    );
}

#[test]
fn a_second_registration_keeps_identical_bytes_including_entry_comments() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    let before = "# user comment\n[mcp_servers.ticketry] # bridge\ncommand = '/app/ticketry-hook' # keep\nargs = [ 'mcp', '--data-dir', '/product/data', '--global' ]\n";
    std::fs::write(&config, before).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Unchanged
    );
    assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
}

#[test]
fn repairs_moved_application_and_strips_extra_fields_without_changing_other_settings() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    let prefix = "# preserve this order\nmodel = 'custom' # user model\n\n[mcp_servers.docs]\ncommand = 'docs-server' # keep\nargs = ['--flag']\n\n";
    let suffix = "\n[projects.'/work']\ntrust_level = 'trusted' # preserve trust\n";
    std::fs::write(&config, format!("{prefix}[mcp_servers.ticketry]\ncommand = '/old-app/ticketry-hook'\nargs = ['mcp', '--data-dir', '/old-data', '--global']\nrequired = true\ncwd = '/old-working-directory'\nstartup_timeout_sec = 99\nenv_vars = ['OLD_SECRET']\n[mcp_servers.ticketry.env]\nTICKETRY_MCP_AUTHORIZATION = 'old-secret'\n{suffix}")).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/new-app/ticketry-hook"),
            Path::new("/new-data")
        ),
        GlobalMcpRegistrationOutcome::Updated
    );
    let after = std::fs::read_to_string(&config).unwrap();
    assert!(after.starts_with(prefix), "{after}");
    assert!(after.ends_with(suffix), "{after}");
    let document = after.parse::<toml_edit::DocumentMut>().unwrap();
    let entry = document["mcp_servers"]["ticketry"].as_table_like().unwrap();
    assert_eq!(entry.len(), 2);
    assert_eq!(
        entry.get("command").unwrap().as_str(),
        Some("/new-app/ticketry-hook")
    );
    assert_eq!(
        entry
            .get("args")
            .unwrap()
            .as_array()
            .unwrap()
            .get(2)
            .unwrap()
            .as_str(),
        Some("/new-data")
    );
    assert!(!after.contains("old-secret"));
}

#[test]
fn leaves_foreign_ticketry_entries_untouched() {
    for entry in [
        "command = '/custom/server'\nargs = ['mcp', '--global']",
        "command = '/app/ticketry-hook'\nargs = ['mcp', '--agent-run-id', 'run']",
        "command = '/app/ticketry-hook'\nargs = ['--global']",
        "command = '/app/ticketry-hook-other'\nargs = ['mcp', '--global']",
        "command = '/app/ticketry-hook'\nargs = 'mcp --global'",
    ] {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.toml");
        let before = format!("[mcp_servers.ticketry]\n{entry}\n");
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
        assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
    }
}

#[test]
fn malformed_or_unsupported_configuration_is_untouched_with_a_safe_diagnostic() {
    for before in [
        "[malformed secret-token",
        "mcp_servers = 'secret-token'\n",
        "mcp_servers = []\n",
    ] {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.toml");
        std::fs::write(&config, before).unwrap();
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
        assert_eq!(std::fs::read_to_string(config).unwrap(), before);
    }
}

#[test]
fn a_locked_configuration_is_untouched() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    let before = "model = 'custom'\n";
    std::fs::write(&config, before).unwrap();
    std::fs::create_dir(root.path().join("config.toml.lock")).unwrap();
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
    assert_eq!(std::fs::read_to_string(config).unwrap(), before);
    assert!(root.path().join("config.toml.lock").is_dir());
}

#[test]
fn skips_without_creating_a_config_tree_when_codex_is_absent() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("absent/config.toml");
    let missing = root.path().join("no-codex");
    assert_eq!(
        register_codex_global_mcp(GlobalMcpRegistrationContext {
            hook_runner: Path::new("/app/ticketry-hook"),
            data_directory: Path::new("/product/data"),
            config_file: Some(&config),
            executable: Some(&missing),
        }),
        GlobalMcpRegistrationOutcome::Skipped {
            reason: "provider_not_installed".into()
        }
    );
    assert!(!config.parent().unwrap().exists());
}

#[test]
fn invalid_paths_are_rejected_before_creating_configuration() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("codex/config.toml");
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
    assert!(matches!(
        register(
            Path::new("/"),
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Failed { .. }
    ));
}

#[test]
fn preserves_inline_mcp_servers_while_creating_ticketry() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    std::fs::write(&config, "# inline servers\nmcp_servers = { docs = { command = 'docs-server' } } # retain\nmodel = 'custom'\n").unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Registered
    );
    let after = std::fs::read_to_string(config).unwrap();
    let document = after.parse::<toml_edit::DocumentMut>().unwrap();
    assert_eq!(
        document["mcp_servers"]["docs"]["command"].as_str(),
        Some("docs-server")
    );
    assert_eq!(
        document["mcp_servers"]["ticketry"]
            .as_table_like()
            .unwrap()
            .len(),
        2
    );
    assert!(after.contains("# inline servers"));
    assert!(after.contains("# retain"));
    assert!(after.contains("model = 'custom'"));
}

#[test]
fn repairing_owned_entry_preserves_its_header_comments_field_order_and_inline_comments() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    std::fs::write(&config, "# bridge settings\n[mcp_servers.ticketry] # user note\nargs = ['mcp', '--data-dir', '/product/data', '--global'] # args note\ncommand = '/old/ticketry-hook' # command note\nrequired = true\n").unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/new/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Updated
    );
    let after = std::fs::read_to_string(config).unwrap();
    assert!(
        after.contains("# bridge settings\n[mcp_servers.ticketry] # user note\n"),
        "{after}"
    );
    assert!(after.contains("# args note"));
    assert!(after.contains("# command note"));
    assert!(after.find("args =").unwrap() < after.find("command =").unwrap());
    assert!(!after.contains("required"));
}

#[cfg(unix)]
#[test]
fn a_read_only_configuration_is_untouched() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    let before = "model = 'custom'\n";
    std::fs::write(&config, before).unwrap();
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o400)).unwrap();
    assert!(matches!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Failed { .. }
    ));
    assert_eq!(std::fs::read_to_string(config).unwrap(), before);
}
