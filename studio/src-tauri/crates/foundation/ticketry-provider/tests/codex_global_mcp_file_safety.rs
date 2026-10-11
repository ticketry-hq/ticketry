#![cfg(unix)]

use std::{
    os::unix::{
        ffi::OsStrExt,
        fs::{symlink, PermissionsExt},
    },
    path::Path,
};
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
fn a_symlinked_config_and_its_target_are_untouched() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    let target = root.path().join("target.toml");
    std::fs::write(&target, "model = 'custom'\n").unwrap();
    symlink(&target, &config).unwrap();
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
    assert_eq!(
        std::fs::read_to_string(target).unwrap(),
        "model = 'custom'\n"
    );
}

#[test]
fn non_utf8_paths_are_rejected_before_creating_configuration() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("codex/config.toml");
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
fn new_configuration_is_owner_only_and_repairs_preserve_permissions() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("codex/config.toml");
    assert_eq!(
        register(
            &config,
            Path::new("/app/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Registered
    );
    assert_eq!(
        std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
        0o600
    );
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o640)).unwrap();
    assert_eq!(
        register(
            &config,
            Path::new("/moved/ticketry-hook"),
            Path::new("/product/data")
        ),
        GlobalMcpRegistrationOutcome::Updated
    );
    assert_eq!(
        std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
        0o640
    );
    let files: Vec<_> = std::fs::read_dir(config.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files, ["config.toml"]);
}
