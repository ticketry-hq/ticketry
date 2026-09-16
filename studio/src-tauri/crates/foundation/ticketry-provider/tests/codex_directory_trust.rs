use std::path::Path;

use ticketry_provider::{
    provider_contract, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, Provider,
};

fn inspect<'a>(directory: &'a Path, config: &'a Path) -> DirectoryTrustInspection {
    provider_contract(Provider::Codex).inspect_directory_trust(DirectoryTrustContext {
        directory,
        trust_file: Some(config),
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
    provider_contract(Provider::Codex).prepare_directory_trust(
        DirectoryTrustContext {
            directory,
            trust_file: Some(config),
        },
        approval,
    )
}

#[test]
fn approved_setup_preserves_toml_denial_and_canonical_identity() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let denied = root.path().join("denied");
    std::fs::create_dir(&real).unwrap();
    std::fs::create_dir(&denied).unwrap();
    let config = root.path().join("codex/config.toml");
    std::fs::create_dir(config.parent().unwrap()).unwrap();
    std::fs::write(
        &config,
        format!(
            "# keep this comment\nmodel = \"custom\"\n\n[projects.{}]\ntrust_level = \"untrusted\"\n",
            toml_key(&denied.canonicalize().unwrap())
        ),
    )
    .unwrap();

    let approved = approval(&real, &config);
    assert_eq!(approved.directory(), real.canonicalize().unwrap());
    assert_eq!(
        prepare(&real, &config, Some(&approved)),
        DirectoryTrustPreparation::Prepared
    );
    let contents = std::fs::read_to_string(&config).unwrap();
    assert!(contents.contains("# keep this comment"));
    assert!(contents.contains("model = \"custom\""));
    assert!(contents.contains("trust_level = \"untrusted\""));
    assert_eq!(inspect(&real, &config), DirectoryTrustInspection::Trusted);
    assert_eq!(inspect(&denied, &config), DirectoryTrustInspection::Denied);
    assert_eq!(
        prepare(&real, &config, None),
        DirectoryTrustPreparation::AlreadyTrusted
    );
    assert_eq!(std::fs::read_to_string(&config).unwrap(), contents);
}

#[test]
fn approval_is_required_and_reread_preserves_a_new_denial() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    let other = root.path().join("other");
    std::fs::create_dir(&directory).unwrap();
    std::fs::create_dir(&other).unwrap();
    let config = root.path().join("config.toml");
    let approved = approval(&directory, &config);

    assert_eq!(
        prepare(&directory, &config, None),
        DirectoryTrustPreparation::ApprovalRequired
    );
    assert_eq!(
        prepare(&other, &config, Some(&approved)),
        DirectoryTrustPreparation::ApprovalRequired
    );
    assert!(!config.exists());

    std::fs::write(
        &config,
        format!(
            "[projects.{}]\ntrust_level = \"untrusted\"\n",
            toml_key(&directory.canonicalize().unwrap())
        ),
    )
    .unwrap();
    let denied = std::fs::read_to_string(&config).unwrap();
    assert_eq!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Denied
    );
    assert_eq!(std::fs::read_to_string(&config).unwrap(), denied);
}

#[test]
fn malformed_config_busy_lock_and_invalid_paths_fail_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    std::fs::create_dir(&directory).unwrap();
    let config = root.path().join("config.toml");

    std::fs::write(&config, "[").unwrap();
    assert!(matches!(
        inspect(&directory, &config),
        DirectoryTrustInspection::Failed(_)
    ));
    assert_eq!(std::fs::read_to_string(&config).unwrap(), "[");

    std::fs::write(&config, "model = \"custom\"\n").unwrap();
    let approved = approval(&directory, &config);
    let lock = root.path().join("config.toml.lock");
    std::fs::create_dir(&lock).unwrap();
    assert!(matches!(
        prepare(&directory, &config, Some(&approved)),
        DirectoryTrustPreparation::Failed(_)
    ));
    assert_eq!(
        std::fs::read_to_string(&config).unwrap(),
        "model = \"custom\"\n"
    );
    std::fs::remove_dir(lock).unwrap();

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

#[cfg(unix)]
#[test]
fn symlinked_config_is_rejected_and_new_config_is_owner_only() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    std::fs::create_dir(&directory).unwrap();
    let target = root.path().join("target.toml");
    let alias = root.path().join("alias.toml");
    std::fs::write(&target, "model = \"custom\"\n").unwrap();
    symlink(&target, &alias).unwrap();
    assert!(matches!(
        inspect(&directory, &alias),
        DirectoryTrustInspection::Failed(_)
    ));
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "model = \"custom\"\n"
    );

    let config = root.path().join("new/config.toml");
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
        .any(|entry| entry.file_name().to_string_lossy().starts_with(".config-")));
}

#[cfg(unix)]
#[test]
fn failed_write_preserves_config_and_leaves_no_temporary_file() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    let config_home = root.path().join("codex");
    let config = config_home.join("config.toml");
    std::fs::create_dir(&directory).unwrap();
    std::fs::create_dir(&config_home).unwrap();
    std::fs::write(&config, "model = \"custom\"\n").unwrap();
    let approved = approval(&directory, &config);
    std::fs::set_permissions(&config_home, std::fs::Permissions::from_mode(0o500)).unwrap();

    let result = prepare(&directory, &config, Some(&approved));

    std::fs::set_permissions(&config_home, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(matches!(result, DirectoryTrustPreparation::Failed(_)));
    assert_eq!(
        std::fs::read_to_string(&config).unwrap(),
        "model = \"custom\"\n"
    );
    assert!(!std::fs::read_dir(&config_home)
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(".config-")));
}

#[test]
fn environment_resolution_uses_codex_home() {
    if let Some(directory) = std::env::var_os("TICKETRY_CODEX_TRUST_DIRECTORY") {
        let directory = Path::new(&directory);
        let context = DirectoryTrustContext {
            directory,
            trust_file: None,
        };
        let provider = provider_contract(Provider::Codex);
        let DirectoryTrustInspection::ApprovalRequired(approval) =
            provider.inspect_directory_trust(context)
        else {
            panic!("isolated Codex home should require approval")
        };
        assert_eq!(
            provider.prepare_directory_trust(context, Some(&approval)),
            DirectoryTrustPreparation::Prepared
        );
        return;
    }

    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("module");
    let codex_home = root.path().join("codex-home");
    std::fs::create_dir(&directory).unwrap();
    assert!(std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "environment_resolution_uses_codex_home"])
        .env("TICKETRY_CODEX_TRUST_DIRECTORY", &directory)
        .env("CODEX_HOME", &codex_home)
        .status()
        .unwrap()
        .success());
    assert!(std::fs::read_to_string(codex_home.join("config.toml"))
        .unwrap()
        .contains("trust_level = \"trusted\""));
}

fn toml_key(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_str()
            .unwrap()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}
