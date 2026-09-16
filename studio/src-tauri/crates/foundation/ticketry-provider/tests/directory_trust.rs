use std::path::Path;

use ticketry_provider::{
    provider_contract, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, Provider,
};

fn inspect<'a>(directory: &'a Path, trust_file: Option<&'a Path>) -> DirectoryTrustInspection {
    provider_contract(Provider::Gemini).inspect_directory_trust(DirectoryTrustContext {
        directory,
        trust_file,
    })
}

fn approval(directory: &Path, trust_file: Option<&Path>) -> DirectoryTrustApproval {
    let DirectoryTrustInspection::ApprovalRequired(approval) = inspect(directory, trust_file)
    else {
        panic!("directory should require approval")
    };
    approval
}

fn prepare(
    directory: &Path,
    trust_file: Option<&Path>,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    provider_contract(Provider::Gemini).prepare_directory_trust(
        DirectoryTrustContext {
            directory,
            trust_file,
        },
        approval,
    )
}

#[test]
fn every_inspection_outcome_is_read_only() {
    let root = tempfile::tempdir().unwrap();
    let trust_file = root.path().join("trust.json");

    std::fs::write(&trust_file, "sentinel").unwrap();
    let before = std::fs::read(&trust_file).unwrap();
    let context = DirectoryTrustContext {
        directory: root.path(),
        trust_file: Some(&trust_file),
    };
    assert!(matches!(
        provider_contract(Provider::Claude).inspect_directory_trust(context),
        DirectoryTrustInspection::Failed(_)
    ));
    assert!(matches!(
        provider_contract(Provider::Claude).prepare_directory_trust(context, None),
        DirectoryTrustPreparation::Failed(_)
    ));
    assert_eq!(
        provider_contract(Provider::Agy).inspect_directory_trust(context),
        DirectoryTrustInspection::Unsupported
    );
    assert_eq!(
        provider_contract(Provider::Agy).prepare_directory_trust(context, None),
        DirectoryTrustPreparation::Unsupported
    );
    assert_eq!(std::fs::read(&trust_file).unwrap(), before);

    std::fs::remove_file(&trust_file).unwrap();
    assert!(matches!(
        inspect(root.path(), Some(&trust_file)),
        DirectoryTrustInspection::ApprovalRequired(_)
    ));
    assert!(!trust_file.exists());

    for malformed in [
        "{",
        "[]",
        "{\"/other\":\"UNKNOWN\"}",
        "{\".\":\"TRUST_FOLDER\"}",
    ] {
        std::fs::write(&trust_file, malformed).unwrap();
        assert!(matches!(
            inspect(root.path(), Some(&trust_file)),
            DirectoryTrustInspection::Failed(_)
        ));
        assert_eq!(std::fs::read_to_string(&trust_file).unwrap(), malformed);
    }

    std::fs::write(
        &trust_file,
        serde_json::to_vec(&serde_json::json!({
            root.path().to_str().unwrap(): "DO_NOT_TRUST"
        }))
        .unwrap(),
    )
    .unwrap();
    let before = std::fs::read(&trust_file).unwrap();
    assert_eq!(
        inspect(root.path(), Some(&trust_file)),
        DirectoryTrustInspection::Denied
    );
    assert_eq!(std::fs::read(&trust_file).unwrap(), before);

    std::fs::write(
        &trust_file,
        serde_json::to_vec(&serde_json::json!({
            root.path().to_str().unwrap(): "TRUST_FOLDER"
        }))
        .unwrap(),
    )
    .unwrap();
    let before = std::fs::read(&trust_file).unwrap();
    assert_eq!(
        inspect(root.path(), Some(&trust_file)),
        DirectoryTrustInspection::Trusted
    );
    assert_eq!(std::fs::read(&trust_file).unwrap(), before);
}

#[test]
fn missing_or_mismatched_approval_never_writes_and_correct_approval_is_idempotent() {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("first");
    let second = root.path().join("second");
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(&second).unwrap();
    let trust_file = root.path().join("config/trust.json");
    let other_file = root.path().join("other/trust.json");
    let first_approval = approval(&first, Some(&trust_file));
    let other_file_approval = approval(&first, Some(&other_file));

    for supplied in [None, Some(&first_approval), Some(&other_file_approval)] {
        assert_eq!(
            prepare(&second, Some(&trust_file), supplied),
            DirectoryTrustPreparation::ApprovalRequired
        );
        assert!(!trust_file.exists());
    }

    assert_eq!(
        prepare(&first, Some(&trust_file), Some(&first_approval)),
        DirectoryTrustPreparation::Prepared
    );
    let prepared = std::fs::read(&trust_file).unwrap();
    assert_eq!(
        prepare(&first, Some(&trust_file), None),
        DirectoryTrustPreparation::AlreadyTrusted
    );
    assert_eq!(std::fs::read(&trust_file).unwrap(), prepared);
}

#[test]
fn denial_and_busy_lock_preserve_existing_rules_then_allow_safe_retry() {
    let root = tempfile::tempdir().unwrap();
    let denied = root.path().join("denied");
    let allowed = root.path().join("allowed");
    std::fs::create_dir(&denied).unwrap();
    std::fs::create_dir(&allowed).unwrap();
    let trust_file = root.path().join("trust.json");
    std::fs::write(&trust_file, "{}").unwrap();
    let stale_approval = approval(&denied, Some(&trust_file));
    std::fs::write(
        &trust_file,
        serde_json::to_vec(&serde_json::json!({denied.to_str().unwrap(): "DO_NOT_TRUST"})).unwrap(),
    )
    .unwrap();
    let before = std::fs::read(&trust_file).unwrap();
    assert_eq!(
        prepare(&denied, Some(&trust_file), Some(&stale_approval)),
        DirectoryTrustPreparation::Denied
    );
    assert_eq!(std::fs::read(&trust_file).unwrap(), before);
    let allowed_approval = approval(&allowed, Some(&trust_file));

    let lock = root.path().join("trust.json.lock");
    std::fs::create_dir(&lock).unwrap();
    assert!(matches!(
        prepare(&allowed, Some(&trust_file), Some(&allowed_approval)),
        DirectoryTrustPreparation::Failed(_)
    ));
    assert_eq!(std::fs::read(&trust_file).unwrap(), before);
    std::fs::remove_dir(lock).unwrap();
    assert_eq!(
        prepare(&allowed, Some(&trust_file), Some(&allowed_approval)),
        DirectoryTrustPreparation::Prepared
    );
    assert_eq!(
        inspect(&allowed, Some(&trust_file)),
        DirectoryTrustInspection::Trusted
    );
    assert!(!std::fs::read_dir(root.path())
        .unwrap()
        .flatten()
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with(".trustedFolders-")));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(trust_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn equal_specificity_retains_provider_file_order_after_replacement() {
    let root = tempfile::tempdir().unwrap();
    let common = root.path().join("shared");
    let allowed = common.join("aa");
    let denied = common.join("zz");
    let other = root.path().join("other");
    for folder in [&allowed, &denied, &other] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let trust_file = root.path().join("trust.json");
    let mut rules = serde_json::Map::new();
    rules.insert(denied.to_str().unwrap().to_owned(), "DO_NOT_TRUST".into());
    rules.insert(allowed.to_str().unwrap().to_owned(), "TRUST_PARENT".into());
    std::fs::write(&trust_file, serde_json::to_vec(&rules).unwrap()).unwrap();

    assert_eq!(
        inspect(&denied, Some(&trust_file)),
        DirectoryTrustInspection::Denied
    );
    let other_approval = approval(&other, Some(&trust_file));
    assert_eq!(
        prepare(&other, Some(&trust_file), Some(&other_approval)),
        DirectoryTrustPreparation::Prepared
    );
    assert_eq!(
        inspect(&denied, Some(&trust_file)),
        DirectoryTrustInspection::Denied
    );
    assert_eq!(
        inspect(&allowed, Some(&trust_file)),
        DirectoryTrustInspection::Trusted
    );
}

#[cfg(unix)]
#[test]
fn canonical_directory_identity_is_reused_and_symlinked_config_is_rejected() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let alias = root.path().join("alias");
    std::fs::create_dir(&real).unwrap();
    symlink(&real, &alias).unwrap();
    let trust_file = root.path().join("trust.json");
    let alias_approval = approval(&alias, Some(&trust_file));
    assert_eq!(alias_approval.directory(), real.canonicalize().unwrap());
    assert_eq!(
        prepare(&alias, Some(&trust_file), Some(&alias_approval)),
        DirectoryTrustPreparation::Prepared
    );
    assert_eq!(
        inspect(&real, Some(&trust_file)),
        DirectoryTrustInspection::Trusted
    );

    let config_alias = root.path().join("config-alias.json");
    symlink(&trust_file, &config_alias).unwrap();
    assert!(matches!(
        inspect(root.path(), Some(&config_alias)),
        DirectoryTrustInspection::Failed(_)
    ));
    assert!(std::fs::symlink_metadata(config_alias)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn environment_paths_follow_gemini_override_and_home_precedence() {
    if let Some(directory) = std::env::var_os("TICKETRY_PROVIDER_TRUST_DIRECTORY") {
        let inspection = inspect(Path::new(&directory), None);
        if directory == "." {
            assert!(matches!(inspection, DirectoryTrustInspection::Failed(_)));
            return;
        }
        let DirectoryTrustInspection::ApprovalRequired(approval) = inspection else {
            panic!("environment-backed directory should require approval")
        };
        assert_eq!(
            prepare(Path::new(&directory), None, Some(&approval)),
            DirectoryTrustPreparation::Prepared
        );
        return;
    }

    for variable in ["GEMINI_CLI_TRUSTED_FOLDERS_PATH", "GEMINI_CLI_HOME"] {
        assert!(std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "environment_paths_follow_gemini_override_and_home_precedence",
            ])
            .env("TICKETRY_PROVIDER_TRUST_DIRECTORY", ".")
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
        let directory = root.path().join(name);
        std::fs::create_dir(&directory).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "environment_paths_follow_gemini_override_and_home_precedence",
            ])
            .env("TICKETRY_PROVIDER_TRUST_DIRECTORY", &directory)
            .env("HOME", &directory)
            .env(
                "GEMINI_CLI_TRUSTED_FOLDERS_PATH",
                if explicit {
                    directory.join("override.json")
                } else {
                    "".into()
                },
            )
            .env(
                "GEMINI_CLI_HOME",
                if gemini_home {
                    directory.join("gemini")
                } else {
                    "".into()
                },
            );
        assert!(command.status().unwrap().success());
        let expected = if explicit {
            directory.join("override.json")
        } else if gemini_home {
            directory.join("gemini/.gemini/trustedFolders.json")
        } else {
            directory.join(".gemini/trustedFolders.json")
        };
        assert!(expected.exists());
    }
}
