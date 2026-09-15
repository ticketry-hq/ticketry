use ticketry_launch::{DirectoryTrustOutcome, DirectoryTrustSetup, Provider};

#[test]
fn linked_folder_approval_is_persisted_and_reused() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("linked");
    std::fs::create_dir(&folder).unwrap();
    let file = root.path().join("config/trustedFolders.json");
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    assert_eq!(
        setup.prepare(&folder, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    assert_eq!(
        DirectoryTrustSetup::new(Provider::Gemini, file)
            .prepare(&folder, false)
            .unwrap(),
        DirectoryTrustOutcome::AlreadyTrusted
    );
}

#[test]
fn shared_descendants_reuse_approval_but_changed_folders_and_isolated_worktrees_need_retry() {
    let root = tempfile::tempdir().unwrap();
    let linked = root.path().join("linked");
    let shared = linked.join("shared");
    let changed = root.path().join("changed");
    let isolated = root.path().join("worktrees/isolated");
    for folder in [&shared, &changed, &isolated] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let file = root.path().join("trust.json");
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    setup.prepare(&linked, true).unwrap();
    let original = std::fs::read(&file).unwrap();
    assert_eq!(
        setup.prepare(&shared, false).unwrap(),
        DirectoryTrustOutcome::AlreadyTrusted
    );
    for folder in [&changed, &isolated] {
        assert_eq!(
            setup.prepare(folder, false).unwrap(),
            DirectoryTrustOutcome::Refused
        );
        assert_eq!(std::fs::read(&file).unwrap(), original);
    }
    assert_eq!(
        setup.prepare(&isolated, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    assert_eq!(
        setup.prepare(&changed, false).unwrap(),
        DirectoryTrustOutcome::Refused
    );
}

#[test]
fn provider_parent_rules_and_more_specific_denials_are_preserved() {
    let root = tempfile::tempdir().unwrap();
    let allowed = root.path().join("shared/allowed");
    let denied = root.path().join("shared/denied_private");
    for folder in [&allowed, &denied] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let file = root.path().join("trust.json");
    let rules = serde_json::json!({
        allowed.to_str().unwrap(): "TRUST_PARENT",
        denied.to_str().unwrap(): "DO_NOT_TRUST"
    });
    std::fs::write(&file, serde_json::to_vec(&rules).unwrap()).unwrap();
    let before = std::fs::read(&file).unwrap();
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    assert_eq!(
        setup.prepare(&allowed, false).unwrap(),
        DirectoryTrustOutcome::AlreadyTrusted
    );
    assert_eq!(
        setup.prepare(&denied, true).unwrap(),
        DirectoryTrustOutcome::Refused
    );
    assert_eq!(std::fs::read(file).unwrap(), before);
}

#[test]
fn malformed_or_unknown_rules_are_preserved_until_fixed_then_retry_succeeds() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("trust.json");
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    for config in [
        "{",
        "[]",
        "{\"/other\":\"UNKNOWN\"}",
        "{/* comment */}",
        "{\".\":\"TRUST_FOLDER\"}",
    ] {
        std::fs::write(&file, config).unwrap();
        assert_eq!(
            setup.prepare(root.path(), true).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), config);
    }
    std::fs::write(&file, "{}").unwrap();
    assert_eq!(
        setup.prepare(root.path(), true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
}

#[test]
fn busy_provider_lock_preserves_rules_and_can_be_retried() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("trust.json");
    std::fs::write(&file, "{}").unwrap();
    let lock = root.path().join("trust.json.lock");
    std::fs::create_dir(&lock).unwrap();
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    assert_eq!(
        setup.prepare(root.path(), true).unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "{}");
    std::fs::remove_dir(lock).unwrap();
    assert_eq!(
        setup.prepare(root.path(), true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn unsupported_providers_and_non_directories_never_create_trust_config() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config/trust.json");
    for provider in [Provider::Claude, Provider::Codex, Provider::Agy] {
        assert_eq!(
            DirectoryTrustSetup::new(provider, config.clone())
                .prepare(root.path(), true)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::Unsupported
        );
    }
    let plain_file = root.path().join("file");
    std::fs::write(&plain_file, "data").unwrap();
    let setup = DirectoryTrustSetup::new(Provider::Gemini, config.clone());
    assert_eq!(
        setup.prepare(&plain_file, true).unwrap_err().kind(),
        std::io::ErrorKind::InvalidInput
    );
    assert_eq!(
        setup.prepare(root.path(), false).unwrap(),
        DirectoryTrustOutcome::Refused
    );
    assert!(!config.parent().unwrap().exists());
}

#[test]
fn environment_paths_follow_gemini_override_and_home_precedence() {
    if let Some(folder) = std::env::var_os("TICKETRY_TRUST_TEST_DIRECTORY") {
        if folder == "." {
            assert_eq!(
                DirectoryTrustSetup::from_environment(Provider::Gemini)
                    .err()
                    .unwrap()
                    .kind(),
                std::io::ErrorKind::InvalidInput
            );
            return;
        }
        let setup = DirectoryTrustSetup::from_environment(Provider::Gemini).unwrap();
        assert_eq!(
            setup.prepare(std::path::Path::new(&folder), true).unwrap(),
            DirectoryTrustOutcome::Prepared
        );
        return;
    }
    for variable in ["GEMINI_CLI_TRUSTED_FOLDERS_PATH", "GEMINI_CLI_HOME"] {
        assert!(std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "environment_paths_follow_gemini_override_and_home_precedence"
            ])
            .env("TICKETRY_TRUST_TEST_DIRECTORY", ".")
            .env_remove("GEMINI_CLI_TRUSTED_FOLDERS_PATH")
            .env_remove("GEMINI_CLI_HOME")
            .env(variable, "relative")
            .status()
            .unwrap()
            .success());
    }
    let root = tempfile::tempdir().unwrap();
    for (name, explicit, gemini_home) in [
        ("override", true, true),
        ("gemini_home", false, true),
        ("home", false, false),
    ] {
        let folder = root.path().join(name);
        std::fs::create_dir(&folder).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "environment_paths_follow_gemini_override_and_home_precedence",
            ])
            .env("TICKETRY_TRUST_TEST_DIRECTORY", &folder)
            .env("HOME", &folder)
            .env(
                "GEMINI_CLI_TRUSTED_FOLDERS_PATH",
                if explicit {
                    folder.join("override.json")
                } else {
                    "".into()
                },
            )
            .env(
                "GEMINI_CLI_HOME",
                if gemini_home {
                    folder.join("gemini")
                } else {
                    "".into()
                },
            );
        assert!(command.status().unwrap().success());
        let expected = if explicit {
            folder.join("override.json")
        } else if gemini_home {
            folder.join("gemini/.gemini/trustedFolders.json")
        } else {
            folder.join(".gemini/trustedFolders.json")
        };
        assert!(expected.exists());
    }
}

#[cfg(unix)]
#[test]
fn symlinked_folders_use_canonical_identity_and_symlinked_config_is_preserved() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let alias = root.path().join("alias");
    std::fs::create_dir(&real).unwrap();
    symlink(&real, &alias).unwrap();
    let file = root.path().join("trust.json");
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file.clone());
    assert_eq!(
        setup.prepare(&alias, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    assert_eq!(
        setup.prepare(&real, false).unwrap(),
        DirectoryTrustOutcome::AlreadyTrusted
    );
    let config_alias = root.path().join("config-alias.json");
    symlink(&file, &config_alias).unwrap();
    assert_eq!(
        DirectoryTrustSetup::new(Provider::Gemini, config_alias.clone())
            .prepare(root.path(), true)
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::InvalidInput
    );
    assert!(std::fs::symlink_metadata(config_alias)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn equal_specificity_retains_first_rule_after_an_unrelated_approval() {
    let root = tempfile::tempdir().unwrap();
    let common = root.path().join("shared");
    let first = common.join("aa");
    let denied = common.join("zz");
    let other = root.path().join("other");
    for folder in [&first, &denied, &other] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let file = root.path().join("trust.json");
    let mut rules = serde_json::Map::new();
    rules.insert(denied.to_str().unwrap().to_owned(), "DO_NOT_TRUST".into());
    rules.insert(first.to_str().unwrap().to_owned(), "TRUST_PARENT".into());
    std::fs::write(&file, serde_json::to_vec(&rules).unwrap()).unwrap();
    let setup = DirectoryTrustSetup::new(Provider::Gemini, file);
    assert_eq!(
        setup.prepare(&denied, false).unwrap(),
        DirectoryTrustOutcome::Refused
    );
    assert_eq!(
        setup.prepare(&other, true).unwrap(),
        DirectoryTrustOutcome::Prepared
    );
    assert_eq!(
        setup.prepare(&denied, false).unwrap(),
        DirectoryTrustOutcome::Refused
    );
    assert_eq!(
        setup.prepare(&first, false).unwrap(),
        DirectoryTrustOutcome::AlreadyTrusted
    );
}
