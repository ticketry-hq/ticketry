//! Fixture-backed tests for executable discovery.
//!
//! The fixtures are real files on disk: discovery is only meaningful when it
//! walks a directory tree and inspects actual Mach-O headers.

use super::approved_paths::{approve_executable_path_in, APPROVED_PATHS_FILE};
use super::candidate_paths::version_manager_bins;
use super::probe::architecture_status;
use super::*;
use std::fs::{self, File};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture_dir(name: &str) -> PathBuf {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = env::temp_dir().join(format!("muxed-discovery-{name}-{id}"));
    fs::create_dir_all(&path).unwrap();
    path
}

fn executable(path: &Path, contents: &[u8]) {
    let mut file = File::create(path).unwrap();
    file.write_all(contents).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn discovers_a_package_manager_fixture_without_path_or_shell() {
    let root = fixture_dir("package-manager");
    let candidate = root.join("codex");
    executable(&candidate, b"#!/bin/sh\nprintf 'codex 0.42.0\\n'\n");
    let service = DiscoveryService {
        roots: vec![root.clone()],
        approved: ApprovedToolPaths::default(),
    };
    let report = service.discover(SupportedTool::Codex);
    let diagnostic = inspect_candidate(&candidate, SupportedTool::Codex, |_, _| {
        Ok("codex 0.42.0".to_owned())
    })
    .unwrap();
    assert_eq!(diagnostic.health, ToolHealth::Ready);
    assert_eq!(diagnostic.version.as_deref(), Some("0.42.0"));
    assert_eq!(report.health, ToolHealth::Ready);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn version_manager_layout_and_paths_with_spaces_are_traversed() {
    let home = fixture_dir("home with spaces");
    let bin = home.join(".nvm/versions/node/v22.1.0/bin");
    fs::create_dir_all(&bin).unwrap();
    let candidate = bin.join("gemini");
    executable(&candidate, b"#!/bin/sh\n");
    assert!(version_manager_bins(&home, ".nvm/versions/node", "bin").contains(&bin));
    let diagnostic = inspect_candidate(&candidate, SupportedTool::Gemini, |_, _| {
        Ok("gemini 1.2.3".to_owned())
    })
    .unwrap();
    assert!(diagnostic.path.unwrap().contains("home with spaces"));
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn rejects_stale_wrong_named_and_non_executable_candidates() {
    let root = fixture_dir("invalid");
    let stale = root.join("claude");
    let wrong_name = root.join("not-claude");
    executable(&stale, b"#!/bin/sh\n");
    executable(&wrong_name, b"#!/bin/sh\n");
    #[cfg(unix)]
    fs::set_permissions(&stale, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(inspect_candidate(&stale, SupportedTool::Claude, |_, _| Ok(
        "claude 1.0.0".to_owned()
    ))
    .is_err());
    assert!(
        inspect_candidate(&wrong_name, SupportedTool::Claude, |_, _| Ok(
            "claude 1.0.0".to_owned()
        ))
        .is_err()
    );
    assert!(
        inspect_candidate(&root.join("missing"), SupportedTool::Claude, |_, _| Ok(
            "claude 1.0.0".to_owned()
        ))
        .is_err()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_wrong_architecture_and_incompatible_versions() {
    let root = fixture_dir("architecture");
    let candidate = root.join("tmux");
    let mut elf = vec![0_u8; 20];
    elf[..4].copy_from_slice(b"\x7fELF");
    elf[18..20].copy_from_slice(&999_u16.to_le_bytes());
    executable(&candidate, &elf);
    assert!(
        inspect_candidate(&candidate, SupportedTool::Tmux, |_, _| Ok(
            "tmux 3.4".to_owned()
        ))
        .is_err()
    );
    let script = root.join("codex");
    executable(&script, b"#!/bin/sh\n");
    assert!(inspect_candidate(&script, SupportedTool::Codex, |_, _| Ok(
        "codex development".to_owned()
    ))
    .is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recognizes_native_thin_macho_headers_in_their_native_byte_order() {
    let root = fixture_dir("native macho");
    let candidate = root.join("tmux");
    let expected_cpu: u32 = match env::consts::ARCH {
        "x86_64" => 0x0100_0007,
        "aarch64" => 0x0100_000c,
        _ => return,
    };
    let mut header = vec![0_u8; 20];
    header[..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
    header[4..8].copy_from_slice(&expected_cpu.to_le_bytes());
    executable(&candidate, &header);

    assert_eq!(architecture_status(&candidate), Ok("native".to_owned()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn approved_absolute_path_is_persisted_and_preferred_on_relaunch() {
    let root = fixture_dir("approved path with spaces");
    let data_dir = root.join("application data");
    let candidate = root.join("custom/bin/codex");
    fs::create_dir_all(candidate.parent().unwrap()).unwrap();
    executable(&candidate, b"#!/bin/sh\nprintf 'codex 1.2.3\\n'\n");

    let approved = approve_executable_path_in(&data_dir, SupportedTool::Codex, candidate)
        .expect("approve valid explicit path");
    assert_eq!(approved.health, ToolHealth::Ready);

    let reloaded = ApprovedToolPaths::load(&data_dir).expect("reload approvals");
    let service = DiscoveryService {
        roots: Vec::new(),
        approved: reloaded,
    };
    let report = service.discover(SupportedTool::Codex);
    assert_eq!(report.health, ToolHealth::Ready);
    assert_eq!(report.version.as_deref(), Some("1.2.3"));
    assert!(report.path.unwrap().contains("approved path with spaces"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_explicit_path_is_not_persisted_or_exported_to_the_backend() {
    let root = fixture_dir("invalid approval");
    let data_dir = root.join("application data");
    let wrong_tool = root.join("claude");
    executable(&wrong_tool, b"#!/bin/sh\nprintf 'claude 1.2.3\\n'\n");

    let error = approve_executable_path_in(&data_dir, SupportedTool::Codex, wrong_tool)
        .expect_err("wrong named tool is rejected");
    assert!(error.contains("identity"));
    assert!(!data_dir.join(APPROVED_PATHS_FILE).exists());

    let environment = resolved_tool_environment_from_service(&DiscoveryService {
        roots: Vec::new(),
        approved: ApprovedToolPaths::default(),
    });
    assert!(!environment
        .iter()
        .any(|(name, _)| name == "MUXED_APPROVED_CODEX_PATH"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn report_serialization_never_includes_probe_output_or_environment_secrets() {
    let diagnostic = inspect_candidate(Path::new("/tmp/codex"), SupportedTool::Codex, |_, _| {
        Ok("token=secret 1.2.3".to_owned())
    });
    assert!(diagnostic.is_err());
    let report = PreflightReport {
        target: "test".to_owned(),
        tools: vec![missing_diagnostic(SupportedTool::Codex)],
        repository_access: working_directory_hint(),
        os_permission_hint: None,
    };
    assert!(!serde_json::to_string(&report).unwrap().contains("secret"));
}
