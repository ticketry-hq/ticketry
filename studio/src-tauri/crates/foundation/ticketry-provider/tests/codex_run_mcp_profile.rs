use ticketry_provider::prepare_codex_run_mcp_profile;

const RUN: &str = "98faaca6-90aa-48b7-8209-aabeaf932bcb";

#[test]
fn run_profile_replaces_only_ticketry_without_changing_originals() {
    let home = tempfile::tempdir().unwrap();
    let base = "[mcp_servers.ticketry]\ncommand='global'\n";
    let selected = "# retain settings\nmodel='chosen'\nmodel_instructions_file='./instructions.md'\n[mcp_servers.other]\ncommand='./other'\n[mcp_servers.ticketry]\ncommand='global'\ncwd='./global'\n[mcp_servers.ticketry.env]\nLEAK='value'\n";
    std::fs::write(home.path().join("config.toml"), base).unwrap();
    std::fs::write(home.path().join("work.config.toml"), selected).unwrap();
    let name = prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).unwrap();
    assert_eq!(name, "ticketry-run-98faaca690aa48b78209aabeaf932bcb");
    let artifact = home.path().join(format!("{name}.config.toml"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&artifact).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let text = std::fs::read_to_string(&artifact).unwrap();
    let document = text.parse::<toml_edit::DocumentMut>().unwrap();
    assert_eq!(document["model"].as_str(), Some("chosen"));
    assert_eq!(
        document["model_instructions_file"].as_str(),
        Some("./instructions.md")
    );
    assert_eq!(
        document["mcp_servers"]["other"]["command"].as_str(),
        Some("./other")
    );
    assert!(document["mcp_servers"]["ticketry"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(text.contains("# retain settings"));
    assert!(!text.contains("LEAK"));
    assert_eq!(
        std::fs::read_to_string(home.path().join("config.toml")).unwrap(),
        base
    );
    assert_eq!(
        std::fs::read_to_string(home.path().join("work.config.toml")).unwrap(),
        selected
    );
    let before = std::fs::metadata(&artifact).unwrap().modified().unwrap();
    assert_eq!(
        prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).unwrap(),
        name
    );
    assert_eq!(
        std::fs::metadata(artifact).unwrap().modified().unwrap(),
        before
    );
}

#[test]
fn no_selected_profile_keeps_base_configuration_out_of_the_artifact() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(
        home.path().join("config.toml"),
        "model='base'\n[mcp_servers.other]\ncommand='base-other'\n",
    )
    .unwrap();
    let name = prepare_codex_run_mcp_profile(RUN, None, Some(home.path())).unwrap();
    let text = std::fs::read_to_string(home.path().join(format!("{name}.config.toml"))).unwrap();
    let document = text.parse::<toml_edit::DocumentMut>().unwrap();
    assert!(!document.contains_key("model"));
    assert!(document["mcp_servers"]["ticketry"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(document["mcp_servers"].as_table().unwrap().len(), 1);
}

#[test]
fn inline_servers_and_resume_refresh_keep_original_profile_changes() {
    let home = tempfile::tempdir().unwrap();
    let selected = home.path().join("work.config.toml");
    std::fs::write(&selected, "model='first'\nmcp_servers={other={command='./other'},ticketry={command='global',env={LEAK='value'}}}\n").unwrap();
    let name = prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).unwrap();
    let artifact = home.path().join(format!("{name}.config.toml"));
    let first = std::fs::read_to_string(&artifact)
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    assert_eq!(
        first["mcp_servers"]["other"]["command"].as_str(),
        Some("./other")
    );
    assert!(first["mcp_servers"]["ticketry"]
        .as_array()
        .unwrap()
        .is_empty());
    std::fs::write(
        &selected,
        "model='updated'\nmcp_servers={other={command='./new-other'}}\n",
    )
    .unwrap();
    assert_eq!(
        prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).unwrap(),
        name
    );
    let refreshed = std::fs::read_to_string(artifact)
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    assert_eq!(refreshed["model"].as_str(), Some("updated"));
    assert_eq!(
        refreshed["mcp_servers"]["other"]["command"].as_str(),
        Some("./new-other")
    );
}

#[test]
fn invalid_identity_missing_or_malformed_profile_fail_without_artifacts() {
    let home = tempfile::tempdir().unwrap();
    assert!(prepare_codex_run_mcp_profile("../run", None, Some(home.path())).is_err());
    assert!(prepare_codex_run_mcp_profile(RUN, Some("../escape"), Some(home.path())).is_err());
    assert!(prepare_codex_run_mcp_profile(RUN, Some("missing"), Some(home.path())).is_err());
    let selected = home.path().join("work.config.toml");
    for text in ["[broken", "mcp_servers=42\n"] {
        std::fs::write(&selected, text).unwrap();
        assert!(prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).is_err());
        assert_eq!(std::fs::read_to_string(&selected).unwrap(), text);
        assert_eq!(std::fs::read_dir(home.path()).unwrap().count(), 1);
    }
}

#[cfg(unix)]
#[test]
fn symlinked_profiles_and_read_only_destination_are_not_replaced() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};
    let home = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(outside.path(), "model='outside'\n").unwrap();
    let selected = home.path().join("work.config.toml");
    symlink(outside.path(), &selected).unwrap();
    assert!(prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).is_err());
    let destination = home
        .path()
        .join("ticketry-run-98faaca690aa48b78209aabeaf932bcb.config.toml");
    symlink(outside.path(), &destination).unwrap();
    assert!(prepare_codex_run_mcp_profile(RUN, None, Some(home.path())).is_err());
    assert!(std::fs::symlink_metadata(&destination)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_to_string(outside.path()).unwrap(),
        "model='outside'\n"
    );
    std::fs::remove_file(&destination).unwrap();
    std::fs::write(&destination, "model='protected'\n").unwrap();
    std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o400)).unwrap();
    assert_eq!(
        prepare_codex_run_mcp_profile(RUN, None, Some(home.path()))
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "model='protected'\n"
    );
}

#[test]
fn configured_and_default_codex_homes_are_resolved_in_an_isolated_process() {
    let root = tempfile::tempdir().unwrap();
    for use_codex_home in [true, false] {
        let codex_home = if use_codex_home {
            root.path().join("custom-codex")
        } else {
            root.path().join(".codex")
        };
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "profile_home_environment_child", "--nocapture"])
            .env("HOME", root.path())
            .env("TICKETRY_PROFILE_TEST_EXPECTED_HOME", &codex_home)
            .env_remove("CODEX_HOME");
        if use_codex_home {
            command.env("CODEX_HOME", &codex_home);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(codex_home
            .join("ticketry-run-98faaca690aa48b78209aabeaf932bcb.config.toml")
            .is_file());
    }
}

#[test]
fn profile_home_environment_child() {
    let Some(expected) = std::env::var_os("TICKETRY_PROFILE_TEST_EXPECTED_HOME") else {
        return;
    };
    let name = prepare_codex_run_mcp_profile(RUN, None, None).unwrap();
    assert!(std::path::PathBuf::from(expected)
        .join(format!("{name}.config.toml"))
        .is_file());
}

#[cfg(unix)]
#[test]
fn read_only_home_and_locked_run_fail_without_partial_artifacts() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempfile::tempdir().unwrap();
    std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = prepare_codex_run_mcp_profile(RUN, None, Some(home.path()));
    std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(
        result.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert_eq!(std::fs::read_dir(home.path()).unwrap().count(), 0);
    let lock = home
        .path()
        .join("ticketry-run-98faaca690aa48b78209aabeaf932bcb.config.toml.ticketry-lock");
    std::fs::create_dir(&lock).unwrap();
    assert_eq!(
        prepare_codex_run_mcp_profile(RUN, None, Some(home.path()))
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(std::fs::read_dir(home.path()).unwrap().count(), 1);
}

#[test]
fn malformed_profile_diagnostics_do_not_echo_its_contents() {
    let home = tempfile::tempdir().unwrap();
    let secret_marker = "PRIVATE_PROFILE_VALUE";
    std::fs::write(
        home.path().join("work.config.toml"),
        format!("token = \"{secret_marker}"),
    )
    .unwrap();
    let error = prepare_codex_run_mcp_profile(RUN, Some("work"), Some(home.path())).unwrap_err();
    assert!(!error.to_string().contains(secret_marker));
}
