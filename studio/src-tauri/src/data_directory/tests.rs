//! Tests for data directory ownership.
//!
//! Every test acquires a real advisory lock on a real temporary directory;
//! exclusivity is not something a stub can demonstrate.

use std::env;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use super::development_mode::{
    development_stack_access, development_stack_state, DevelopmentStackMarker,
    DevelopmentStackState, DEVELOPMENT_STACK_MARKER,
};
use super::owner_record::{now_millis, write_owner, LOCK_FILE_NAME};
use super::*;

fn temp_data_directory(name: &str) -> PathBuf {
    let directory = env::temp_dir().join(format!(
        "muxed-ownership-{name}-{}-{}",
        std::process::id(),
        now_millis()
    ));
    fs::create_dir_all(&directory).expect("create test data directory");
    directory
}

fn acquire_owned(directory: &Path) -> DataDirectoryGuard {
    match DataDirectoryGuard::acquire(directory, DevelopmentMode::Forbid, 0)
        .expect("ownership acquisition")
    {
        DataDirectoryAccess::Owned(guard) => guard,
        DataDirectoryAccess::DevelopmentStack => panic!("port zero cannot be a dev stack"),
    }
}

#[test]
fn two_instances_cannot_own_one_data_directory() {
    let directory = temp_data_directory("exclusive");
    let first = acquire_owned(&directory);
    let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
        .expect_err("second owner must be refused");

    assert!(matches!(error, OwnershipError::DataDirectoryInUse { .. }));
    first.release().expect("release first owner");
    let second = acquire_owned(&directory);
    second.release().expect("release second owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn contended_explicit_data_directory_diagnostic_names_the_directory() {
    let directory = temp_data_directory("explicit-contention");
    let first = acquire_owned(&directory);
    let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
        .expect_err("second owner must be refused");
    let diagnostic = format!(
        "could not own selected data directory {}: {error}",
        directory.display()
    );

    assert!(diagnostic.contains(&directory.display().to_string()));
    assert!(diagnostic.contains("already owned"));
    first.release().expect("release first owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn distinct_data_directories_can_be_owned_concurrently_and_isolate_writes() {
    let first_directory = temp_data_directory("concurrent-first");
    let second_directory = temp_data_directory("concurrent-second");
    let first = acquire_owned(&first_directory);
    let second = acquire_owned(&second_directory);

    fs::write(first_directory.join("sentinel"), b"first profile")
        .expect("write first profile sentinel");
    assert!(!second_directory.join("sentinel").exists());

    first.release().expect("release first owner");
    second.release().expect("release second owner");
    fs::remove_dir_all(first_directory).expect("clean first test directory");
    fs::remove_dir_all(second_directory).expect("clean second test directory");
}

#[test]
fn an_uncreatable_selected_directory_is_named_in_the_error() {
    let parent = temp_data_directory("uncreatable");
    let file = parent.join("not-a-directory");
    fs::write(&file, b"blocking file").expect("create blocking file");
    let selected = file.join("profile");

    let error = DataDirectoryGuard::acquire(&selected, DevelopmentMode::Forbid, 0)
        .expect_err("directory beneath a file must be rejected");

    assert!(error.to_string().contains(&selected.display().to_string()));
    fs::remove_dir_all(parent).expect("clean test directory");
}

#[test]
fn stale_metadata_is_reclaimed_without_manual_cleanup() {
    let directory = temp_data_directory("stale");
    let lock_path = directory.join(LOCK_FILE_NAME);
    let stale = OwnerIdentity {
        pid: 999_999,
        nonce: "forced-quit-owner".to_owned(),
        acquired_at_millis: 1,
    };
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(lock_path)
        .expect("create stale metadata");
    write_owner(&mut file, &stale).expect("write stale metadata");
    drop(file);

    let guard = acquire_owned(&directory);
    assert!(guard.reclaimed_stale_metadata());
    guard.release().expect("release relaunched owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn an_existing_data_directory_is_used_in_place() {
    let directory = temp_data_directory("existing");
    let existing = directory.join("state.db");
    fs::write(&existing, b"existing sqlite bytes").expect("seed existing state");

    let guard = acquire_owned(&directory);
    assert_eq!(
        fs::read(&existing).expect("read existing state"),
        b"existing sqlite bytes"
    );
    guard.release().expect("release owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn a_fresh_data_directory_is_created_without_a_layout_migration() {
    let directory = env::temp_dir().join(format!(
        "muxed-ownership-fresh-{}-{}",
        std::process::id(),
        now_millis()
    ));
    assert!(!directory.exists(), "test path must begin absent");

    let guard = acquire_owned(&directory);
    assert!(directory.is_dir());
    assert_eq!(guard.lock_path(), directory.join(LOCK_FILE_NAME));
    guard.release().expect("release owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn forced_quit_child() {
    let Some(directory) = env::var_os("MUXED_OWNERSHIP_FORCED_QUIT_DIRECTORY") else {
        return;
    };
    let _guard = acquire_owned(Path::new(&directory));
    // Deliberately bypass Drop to model a process that the OS terminates.
    std::process::exit(0);
}

#[test]
fn forced_quit_relaunches_without_manual_cleanup() {
    let directory = temp_data_directory("forced-quit");
    let status = std::process::Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "data_directory::tests::forced_quit_child",
            "--nocapture",
        ])
        .env("MUXED_OWNERSHIP_FORCED_QUIT_DIRECTORY", &directory)
        .status()
        .expect("start forced-quit owner");
    assert!(status.success());

    let guard = acquire_owned(&directory);
    assert!(guard.reclaimed_stale_metadata());
    guard.release().expect("release relaunched owner");
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn running_dev_backend_requires_explicit_connect_mode() {
    let port = 8787;
    let error = development_stack_access(DevelopmentMode::Forbid, true, port)
        .expect_err("implicit dev sharing must fail");
    assert!(matches!(
        error,
        OwnershipError::DevelopmentStackDetected { port: detected } if detected == port
    ));
    assert!(
        development_stack_access(DevelopmentMode::Connect, true, port).expect("explicit dev mode")
    );
}

#[test]
fn connect_mode_without_a_verified_development_stack_fails_closed() {
    let directory = temp_data_directory("connect-without-stack");
    let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Connect, 0)
        .expect_err("connect mode must never fall through to owned sidecar mode");

    assert!(matches!(
        error,
        OwnershipError::DevelopmentStackUnavailable { port: 0 }
    ));
    assert!(error.to_string().contains("start `pnpm dev`"));
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn matching_dev_stack_marker_allows_only_explicit_connect_mode() {
    let directory = temp_data_directory("dev-marker");
    let marker = DevelopmentStackMarker {
        data_dir: directory.clone(),
        supervisor_pid: std::process::id(),
        backend_port: 0,
    };
    fs::write(
        directory.join(DEVELOPMENT_STACK_MARKER),
        serde_json::to_vec(&marker).expect("serialize marker"),
    )
    .expect("write marker");

    assert_eq!(
        development_stack_state(&directory, 0),
        DevelopmentStackState::Verified
    );
    let error = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, 0)
        .expect_err("implicit dev sharing must fail");
    assert!(matches!(
        error,
        OwnershipError::DevelopmentStackDetected { port: 0 }
    ));
    assert!(matches!(
        DataDirectoryGuard::acquire(&directory, DevelopmentMode::Connect, 0)
            .expect("explicit dev connect"),
        DataDirectoryAccess::DevelopmentStack
    ));
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn marker_for_another_data_directory_does_not_enable_connect_mode() {
    let directory = temp_data_directory("dev-marker-mismatch");
    let other_directory = temp_data_directory("dev-marker-other");
    let marker = DevelopmentStackMarker {
        data_dir: other_directory.clone(),
        supervisor_pid: std::process::id(),
        backend_port: 0,
    };
    fs::write(
        directory.join(DEVELOPMENT_STACK_MARKER),
        serde_json::to_vec(&marker).expect("serialize marker"),
    )
    .expect("write marker");

    assert_eq!(
        development_stack_state(&directory, 0),
        DevelopmentStackState::Absent
    );
    let guard = acquire_owned(&directory);
    guard.release().expect("release owner");
    fs::remove_dir_all(directory).expect("clean test directory");
    fs::remove_dir_all(other_directory).expect("clean test directory");
}

#[test]
fn unrelated_listener_on_the_development_port_does_not_block_ownership() {
    let directory = temp_data_directory("unrelated-development-port");
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind unrelated local service");
    let port = listener.local_addr().expect("listener address").port();

    let guard = DataDirectoryGuard::acquire(&directory, DevelopmentMode::Forbid, port)
        .expect("an unrelated service on the conventional port must not own this directory");
    assert!(matches!(guard, DataDirectoryAccess::Owned(_)));

    drop(listener);
    drop(guard);
    fs::remove_dir_all(directory).expect("clean test directory");
}

#[test]
fn invalid_development_mode_is_actionable() {
    assert!(matches!(
        DevelopmentMode::parse("true"),
        Err(OwnershipError::InvalidDevelopmentMode(value)) if value == "true"
    ));
}
