use std::path::{Path, PathBuf};

use ticketry_provider::{
    provider_contract, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, Provider,
};

fn inspect<'a>(directory: &'a Path, config: &'a Path) -> DirectoryTrustInspection {
    provider_contract(Provider::Claude).inspect_directory_trust(DirectoryTrustContext {
        directory,
        trust_file: Some(config),
        executable: None,
    })
}

fn approval(directory: &Path, config: &Path) -> DirectoryTrustApproval {
    let DirectoryTrustInspection::ApprovalRequired(approval) = inspect(directory, config) else {
        panic!("directory should require approval")
    };
    approval
}

fn prepare(
    directory: &Path,
    config: &Path,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    provider_contract(Provider::Claude).prepare_directory_trust(
        DirectoryTrustContext {
            directory,
            trust_file: Some(config),
            executable: None,
        },
        approval,
    )
}

#[test]
fn approved_setup_preserves_application_state_and_treats_false_as_untrusted() {
    let root = tempfile::tempdir().unwrap();
    let allowed = root.path().join("allowed");
    let denied = root.path().join("denied");
    std::fs::create_dir(&allowed).unwrap();
    std::fs::create_dir(&denied).unwrap();
    let config = root.path().join("claude/.claude.json");
    std::fs::create_dir(config.parent().unwrap()).unwrap();
    let denied_key = denied.canonicalize().unwrap();
    std::fs::write(
        &config,
        serde_json::to_vec_pretty(&serde_json::json!({
            "oauthAccount": {"emailAddress": "keep@example.com"},
            "theme": "dark",
            "projects": {
                denied_key.to_str().unwrap(): {
                    "hasTrustDialogAccepted": false,
                    "allowedTools": ["Read"]
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let approved = approval(&allowed, &config);
    assert_eq!(approved.directory(), allowed.canonicalize().unwrap());
    assert_eq!(
        prepare(&allowed, &config, Some(&approved)),
        DirectoryTrustPreparation::Prepared
    );

    let state: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    assert_eq!(state["oauthAccount"]["emailAddress"], "keep@example.com");
    assert_eq!(state["theme"], "dark");
    assert_eq!(
        state["projects"][denied_key.to_str().unwrap()]["allowedTools"][0],
        "Read"
    );
    assert!(matches!(
        inspect(&denied, &config),
        DirectoryTrustInspection::ApprovalRequired(_)
    ));
    assert_eq!(
        inspect(&allowed, &config),
        DirectoryTrustInspection::Trusted
    );
    assert_eq!(
        prepare(&allowed, &config, None),
        DirectoryTrustPreparation::AlreadyTrusted
    );
}

#[test]
fn approval_reread_preserves_concurrent_state_and_busy_lock_then_retries() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    let other = root.path().join("other");
    std::fs::create_dir(&directory).unwrap();
    std::fs::create_dir(&other).unwrap();
    let config = root.path().join(".claude.json");
    let approved = approval(&directory, &config);

    assert_eq!(
        prepare(&other, &config, Some(&approved)),
        DirectoryTrustPreparation::ApprovalRequired
    );
    assert!(!config.exists());

    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "projects": {
                directory.canonicalize().unwrap().to_str().unwrap(): {
                    "hasTrustDialogAccepted": false
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let refreshed = std::fs::read(&config).unwrap();
    assert_eq!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Prepared
    );
    assert_ne!(std::fs::read(&config).unwrap(), refreshed);

    std::fs::write(&config, "{}").unwrap();
    let approved = approval(&directory, &config);
    std::fs::create_dir(root.path().join(".claude.json.lock")).unwrap();
    assert!(matches!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Failed(_)
    ));
    assert_eq!(std::fs::read_to_string(&config).unwrap(), "{}");
    std::fs::remove_dir(root.path().join(".claude.json.lock")).unwrap();
    assert_eq!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Prepared
    );
}

#[test]
fn malformed_or_unrecognized_state_and_invalid_paths_fail_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    std::fs::create_dir(&directory).unwrap();
    let config = root.path().join(".claude.json");

    for malformed in [
        "{",
        "[]",
        r#"{"projects": []}"#,
        r#"{"projects": {"relative": {}}}"#,
        r#"{"projects": {"/tmp/x": {"hasTrustDialogAccepted": "yes"}}}"#,
    ] {
        std::fs::write(&config, malformed).unwrap();
        assert!(matches!(
            inspect(&directory, &config),
            DirectoryTrustInspection::Failed(_)
        ));
        assert_eq!(std::fs::read_to_string(&config).unwrap(), malformed);
    }

    assert!(matches!(
        inspect(Path::new("."), &config),
        DirectoryTrustInspection::Failed(_)
    ));
    let file = root.path().join("file");
    std::fs::write(&file, "not a directory").unwrap();
    assert!(matches!(
        inspect(&file, &config),
        DirectoryTrustInspection::Failed(_)
    ));
}

#[test]
fn repository_subdirectories_use_the_canonical_repository_root_key() {
    let root = tempfile::tempdir().unwrap();
    let repository = root.path().join("repository");
    let nested = repository.join("nested/module");
    std::fs::create_dir_all(repository.join(".git")).unwrap();
    std::fs::create_dir_all(&nested).unwrap();
    let config = root.path().join(".claude.json");
    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "projects": {
                repository.canonicalize().unwrap().to_str().unwrap(): {
                    "hasTrustDialogAccepted": true
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    assert_eq!(inspect(&nested, &config), DirectoryTrustInspection::Trusted);
}

#[test]
fn approval_is_renewed_when_the_provider_trust_key_changes() {
    let root = tempfile::tempdir().unwrap();
    let repository = root.path().join("repository");
    let nested = repository.join("nested/module");
    std::fs::create_dir_all(&nested).unwrap();
    let config = root.path().join(".claude.json");
    let approved = approval(&nested, &config);

    std::fs::create_dir(repository.join(".git")).unwrap();

    assert_eq!(
        prepare(&nested, &config, Some(&approved)),
        DirectoryTrustPreparation::ApprovalRequired
    );
    assert!(!config.exists());
}

#[cfg(unix)]
#[test]
fn symlinked_state_is_rejected_and_new_state_is_owner_only() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    std::fs::create_dir(&directory).unwrap();
    let target = root.path().join("target.json");
    let alias = root.path().join("alias.json");
    std::fs::write(&target, "{}").unwrap();
    symlink(&target, &alias).unwrap();
    assert!(matches!(
        inspect(&directory, &alias),
        DirectoryTrustInspection::Failed(_)
    ));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "{}");

    let config = root.path().join("new/.claude.json");
    let approved = approval(&directory, &config);
    assert_eq!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Prepared
    );
    assert_eq!(
        std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!std::fs::read_dir(config.parent().unwrap())
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(".claude-")));
}

#[cfg(unix)]
#[test]
fn active_config_override_version_and_home_limit_are_enforced() {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(case) = std::env::var("TICKETRY_CLAUDE_TRUST_CASE") {
        let directory = std::env::var_os("TICKETRY_CLAUDE_TRUST_DIRECTORY").unwrap();
        let executable = std::env::var_os("TICKETRY_CLAUDE_EXECUTABLE").map(PathBuf::from);
        let context = DirectoryTrustContext {
            directory: Path::new(&directory),
            trust_file: None,
            executable: executable.as_deref(),
        };
        let provider = provider_contract(Provider::Claude);
        match case.as_str() {
            "supported" | "supported_current" | "supported_latest" => {
                let DirectoryTrustInspection::ApprovalRequired(approval) =
                    provider.inspect_directory_trust(context)
                else {
                    panic!("supported Claude should require approval")
                };
                assert_eq!(
                    provider.prepare_directory_trust(context, Some(&approval)),
                    DirectoryTrustPreparation::Prepared
                );
            }
            "unsupported" | "unsupported_next" => {
                let DirectoryTrustInspection::Failed(failure) =
                    provider.inspect_directory_trust(context)
                else {
                    panic!("unsupported Claude should fail with its version")
                };
                assert!(failure.message.contains(if case == "unsupported_next" {
                    "2.1.279"
                } else {
                    "2.1.271"
                }));
                assert!(matches!(
                    provider.prepare_directory_trust(context, None),
                    DirectoryTrustPreparation::Failed(_)
                ));
            }
            "home" => {
                let DirectoryTrustInspection::Failed(failure) =
                    provider.inspect_directory_trust(context)
                else {
                    panic!("Claude home directory should fail")
                };
                assert!(failure.message.contains("home directory"));
            }
            _ => unreachable!(),
        }
        return;
    }

    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    let module = root.path().join("module");
    let home = root.path().join("home");
    let config = root.path().join("config");
    for directory in [&bin, &module, &home, &config] {
        std::fs::create_dir(directory).unwrap();
    }
    let executable = bin.join("claude");
    for (case, version, directory, process_home) in [
        ("unsupported", "2.1.271", &module, &home),
        ("unsupported_next", "2.1.279", &module, &home),
        ("supported", "2.1.270", &module, &home),
        ("supported_current", "2.1.276", &module, &home),
        ("supported_latest", "2.1.278", &module, &home),
        ("home", "2.1.270", &home, &home),
    ] {
        std::fs::write(
            &executable,
            format!("#!/bin/sh\necho '{version} (Claude Code)'\n"),
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "active_config_override_version_and_home_limit_are_enforced",
            ])
            .env("TICKETRY_CLAUDE_TRUST_CASE", case)
            .env("TICKETRY_CLAUDE_TRUST_DIRECTORY", directory)
            .env("TICKETRY_CLAUDE_EXECUTABLE", &executable)
            .env("CLAUDE_CONFIG_DIR", config.join(case))
            .env("HOME", process_home)
            .env("PATH", "/usr/bin:/bin")
            .status()
            .unwrap()
            .success());
    }
    assert!(config.join("supported/.claude.json").exists());
    assert!(config.join("supported_current/.claude.json").exists());
    assert!(config.join("supported_latest/.claude.json").exists());
    assert!(!config.join("unsupported/.claude.json").exists());
    assert!(!config.join("unsupported_next/.claude.json").exists());
}
