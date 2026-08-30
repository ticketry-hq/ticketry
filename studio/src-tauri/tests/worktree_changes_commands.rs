//! Commit and push through the public GraphQL boundary for both Changes views.

#[path = "common/worktree_completion_git.rs"]
mod git_fixture;
#[path = "common/worktree_completion_support.rs"]
mod support;

use std::path::{Path, PathBuf};
use std::process::Command;

use git_fixture::{Scenario, BRANCH};
use support::fixture;

const TASK: &str = "60000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";

const TASK_CHANGES: &str = r#"query($taskId: String!) {
  worktree_changes(task_id: $taskId) {
    clean dirty unpushed_count files { path status }
  }
}"#;
const MODULE_CHANGES: &str = r#"query($moduleId: String!) {
  module_version_control(module_id: $moduleId) {
    checkout { clean dirty unpushed_count files { path status } }
  }
}"#;
const TASK_COMMIT: &str = r#"mutation($taskId: String!, $operationId: String!, $message: String!) {
  worktree_commit(task_id: $taskId, operation_id: $operationId, message: $message) {
    operation_id head_commit dirty unpushed_count uncommitted_work_excluded
  }
}"#;
const TASK_PUSH: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_push(task_id: $taskId, operation_id: $operationId) {
    operation_id head_commit dirty unpushed_count uncommitted_work_excluded
  }
}"#;
const MODULE_COMMIT: &str = r#"mutation($moduleId: String!, $operationId: String!, $message: String!) {
  module_checkout_commit(module_id: $moduleId, operation_id: $operationId, message: $message) {
    operation_id head_commit dirty unpushed_count uncommitted_work_excluded
  }
}"#;
const MODULE_PUSH: &str = r#"mutation($moduleId: String!, $operationId: String!) {
  module_checkout_push(module_id: $moduleId, operation_id: $operationId) {
    operation_id head_commit dirty unpushed_count uncommitted_work_excluded
  }
}"#;

fn git(arguments: &[&str], directory: &Path) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Ticketry Test")
        .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
        .env("GIT_COMMITTER_NAME", "Ticketry Test")
        .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(path: &Path, contents: &str) {
    std::fs::write(path, contents).expect("write fixture file");
}

fn operation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn error_code(response: &serde_json::Value) -> &str {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .expect("structured error code")
}

struct Remote {
    _directory: tempfile::TempDir,
    bare: PathBuf,
}

fn attach_remote(repository: &Path) -> Remote {
    let directory = tempfile::tempdir().expect("create remote fixture");
    let bare = directory.path().join("origin.git");
    git(
        &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        directory.path(),
    );
    git(
        &["remote", "add", "origin", bare.to_str().unwrap()],
        repository,
    );
    git(&["push", "--set-upstream", "origin", "main"], repository);
    Remote {
        _directory: directory,
        bare,
    }
}

#[tokio::test]
async fn task_commit_keeps_the_cumulative_diff_and_clean_agent_commits_can_push() {
    let fixture = fixture(Scenario::Clean).await;
    let remote = attach_remote(fixture.repository_path());
    write(&fixture.checkout_path().join("task.txt"), "task work\n");

    let committed = fixture
        .graphql(
            TASK_COMMIT,
            serde_json::json!({
                "taskId": TASK,
                "operationId": operation_id(),
                "message": "Record task work",
            }),
        )
        .await;
    assert_eq!(
        committed["errors"],
        serde_json::Value::Null,
        "{committed:#}"
    );
    assert_eq!(committed["data"]["worktree_commit"]["dirty"], false);
    assert_eq!(committed["data"]["worktree_commit"]["unpushed_count"], 1);

    let changes = fixture
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(changes["data"]["worktree_changes"]["clean"], true);
    assert_eq!(changes["data"]["worktree_changes"]["unpushed_count"], 1);
    assert_eq!(
        changes["data"]["worktree_changes"]["files"][0]["path"],
        "task.txt"
    );

    let pushed = fixture
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(pushed["errors"], serde_json::Value::Null, "{pushed:#}");
    assert_eq!(pushed["data"]["worktree_push"]["unpushed_count"], 0);
    assert_eq!(
        git(&["rev-parse", BRANCH], &remote.bare),
        git(&["rev-parse", "HEAD"], fixture.checkout_path())
    );
}

#[tokio::test]
async fn task_push_leaves_dirty_work_byte_for_byte_untouched() {
    let fixture = fixture(Scenario::Clean).await;
    let _remote = attach_remote(fixture.repository_path());
    write(
        &fixture.checkout_path().join("committed.txt"),
        "committed\n",
    );
    git(&["add", "committed.txt"], fixture.checkout_path());
    git(&["commit", "-m", "agent commit"], fixture.checkout_path());
    write(&fixture.checkout_path().join("dirty.txt"), "stay local\n");
    let before_head = git(&["rev-parse", "HEAD"], fixture.checkout_path());
    let before_status = git(&["status", "--porcelain=v1"], fixture.checkout_path());

    let pushed = fixture
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(pushed["errors"], serde_json::Value::Null, "{pushed:#}");
    assert_eq!(
        pushed["data"]["worktree_push"]["uncommitted_work_excluded"],
        true
    );
    assert_eq!(
        git(&["rev-parse", "HEAD"], fixture.checkout_path()),
        before_head
    );
    assert_eq!(
        git(&["status", "--porcelain=v1"], fixture.checkout_path()),
        before_status
    );
    assert_eq!(
        std::fs::read_to_string(fixture.checkout_path().join("dirty.txt")).unwrap(),
        "stay local\n"
    );
}

#[tokio::test]
async fn module_checkout_commit_and_push_use_the_same_independent_rules() {
    let fixture = fixture(Scenario::Clean).await;
    let remote = attach_remote(fixture.repository_path());
    write(
        &fixture.repository_path().join("module.txt"),
        "module work\n",
    );

    let before = fixture
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    assert_eq!(
        before["data"]["module_version_control"]["checkout"]["dirty"],
        true
    );
    assert_eq!(
        before["data"]["module_version_control"]["checkout"]["unpushed_count"],
        0
    );

    let committed = fixture
        .graphql(
            MODULE_COMMIT,
            serde_json::json!({
                "moduleId": MODULE,
                "operationId": operation_id(),
                "message": "Record module work",
            }),
        )
        .await;
    assert_eq!(
        committed["errors"],
        serde_json::Value::Null,
        "{committed:#}"
    );
    assert_eq!(
        committed["data"]["module_checkout_commit"]["unpushed_count"],
        1
    );

    let pushed = fixture
        .graphql(
            MODULE_PUSH,
            serde_json::json!({"moduleId": MODULE, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(pushed["errors"], serde_json::Value::Null, "{pushed:#}");
    assert_eq!(pushed["data"]["module_checkout_push"]["unpushed_count"], 0);
    assert_eq!(
        git(&["rev-parse", "main"], &remote.bare),
        git(&["rev-parse", "HEAD"], fixture.repository_path())
    );
}

#[tokio::test]
async fn command_preconditions_and_push_failures_keep_structured_codes() {
    let empty = fixture(Scenario::Clean).await;
    let no_commit = empty
        .graphql(
            TASK_COMMIT,
            serde_json::json!({"taskId": TASK, "operationId": operation_id(), "message": "No work"}),
        )
        .await;
    assert_eq!(error_code(&no_commit), "worktree_commit_no_changes");

    let no_push = empty
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&no_push), "worktree_push_no_commits");

    write(&empty.checkout_path().join("ahead.txt"), "ahead\n");
    git(&["add", "ahead.txt"], empty.checkout_path());
    git(&["commit", "-m", "ahead"], empty.checkout_path());
    let missing = empty
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&missing), "worktree_push_missing_upstream");

    let generic = fixture(Scenario::Clean).await;
    git(
        &[
            "remote",
            "add",
            "origin",
            "/definitely/missing/ticketry.git",
        ],
        generic.repository_path(),
    );
    write(&generic.checkout_path().join("ahead.txt"), "ahead\n");
    git(&["add", "ahead.txt"], generic.checkout_path());
    git(&["commit", "-m", "ahead"], generic.checkout_path());
    let failed = generic
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&failed), "worktree_push_git_failed");
}

#[tokio::test]
async fn non_fast_forward_push_is_structured_and_keeps_refreshable_state() {
    let fixture = fixture(Scenario::Clean).await;
    let remote = attach_remote(fixture.repository_path());
    write(&fixture.checkout_path().join("first.txt"), "first\n");
    git(&["add", "first.txt"], fixture.checkout_path());
    git(&["commit", "-m", "first"], fixture.checkout_path());
    let first = fixture
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(first["errors"], serde_json::Value::Null, "{first:#}");

    let competitor = remote._directory.path().join("competitor");
    git(
        &[
            "clone",
            remote.bare.to_str().unwrap(),
            competitor.to_str().unwrap(),
        ],
        remote._directory.path(),
    );
    git(&["checkout", BRANCH], &competitor);
    write(&competitor.join("remote.txt"), "remote\n");
    git(&["add", "remote.txt"], &competitor);
    git(&["commit", "-m", "remote advance"], &competitor);
    git(&["push", "origin", BRANCH], &competitor);

    write(&fixture.checkout_path().join("local.txt"), "local\n");
    git(&["add", "local.txt"], fixture.checkout_path());
    git(&["commit", "-m", "local advance"], fixture.checkout_path());
    let local_head = git(&["rev-parse", "HEAD"], fixture.checkout_path());
    let rejected = fixture
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&rejected), "worktree_push_non_fast_forward");
    assert_eq!(
        git(&["rev-parse", "HEAD"], fixture.checkout_path()),
        local_head
    );
    let refreshed = fixture
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        refreshed["errors"],
        serde_json::Value::Null,
        "{refreshed:#}"
    );
    assert_eq!(refreshed["data"]["worktree_changes"]["unpushed_count"], 1);
}

#[cfg(unix)]
#[tokio::test]
async fn authentication_failure_has_its_own_code() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = fixture(Scenario::Clean).await;
    let script_dir = tempfile::tempdir().expect("create fake ssh fixture");
    let script = script_dir.path().join("deny-ssh");
    std::fs::write(
        &script,
        "#!/bin/sh\necho 'Permission denied (publickey).' >&2\nexit 255\n",
    )
    .expect("write fake ssh command");
    let mut permissions = std::fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(&script, permissions).expect("make fake ssh executable");
    git(
        &[
            "remote",
            "add",
            "origin",
            "ssh://ticketry.invalid/repository",
        ],
        fixture.repository_path(),
    );
    git(
        &["config", "core.sshCommand", script.to_str().unwrap()],
        fixture.repository_path(),
    );
    write(&fixture.checkout_path().join("ahead.txt"), "ahead\n");
    git(&["add", "ahead.txt"], fixture.checkout_path());
    git(&["commit", "-m", "ahead"], fixture.checkout_path());

    let response = fixture
        .graphql(
            TASK_PUSH,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&response), "worktree_push_authentication_failed");
}
