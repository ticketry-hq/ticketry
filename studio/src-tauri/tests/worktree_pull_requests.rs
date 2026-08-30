//! Pull-request creation through the public GraphQL boundary for both Changes views.

#[path = "common/worktree_completion_git.rs"]
mod git_fixture;
#[path = "common/worktree_completion_support.rs"]
mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use git_fixture::{Scenario, BRANCH};
use support::fixture;

const TASK: &str = "60000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
static GITHUB_ENV: Mutex<()> = Mutex::new(());

const TASK_PULL_REQUEST: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_pull_request_create(task_id: $taskId, operation_id: $operationId) {
    url branch base_branch pushed uncommitted_work_excluded
  }
}"#;
const MODULE_PULL_REQUEST: &str = r#"mutation($moduleId: String!, $operationId: String!) {
  module_checkout_pull_request_create(module_id: $moduleId, operation_id: $operationId) {
    url branch base_branch pushed uncommitted_work_excluded
  }
}"#;
const REPLACE_PULL_REQUEST: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_pull_request_replace(task_id: $taskId, operation_id: $operationId) {
    url branch base_branch pushed uncommitted_work_excluded
  }
}"#;
const FOLLOW_UP_PULL_REQUEST: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_pull_request_follow_up(task_id: $taskId, operation_id: $operationId) {
    url branch base_branch pushed uncommitted_work_excluded
  }
}"#;
const CLEANUP_WORKTREE: &str = r#"mutation($taskId: String!, $operationId: String!, $confirmed: Boolean!) {
  worktree_cleanup(task_id: $taskId, operation_id: $operationId, confirmed: $confirmed) {
    removed task_id top_level_task_id branch reason
    status { kind checkout_present }
  }
}"#;
const TASK_CHANGES: &str = r#"query($taskId: String!) {
  worktree_changes(task_id: $taskId) {
    pull_request_url pull_request_creation_eligible committed_count dirty
    work_item_done
    closure_failure { code message from_state to_state }
    cleanup { eligible blocker reason }
    pull_request {
      url state target_branch head_commit integrated post_merge_work
      replacement_eligible follow_up_eligible merge_preparation_eligible reason
    }
  }
}"#;
const WORK_ITEM_STATE: &str = r#"query($id: String!) {
  worktrackerIssue(filters: { id: { eq: $id } }) {
    nodes { id state { name } }
  }
}"#;
const MODULE_CHANGES: &str = r#"query($moduleId: String!) {
  module_version_control(module_id: $moduleId) {
    checkout {
      branch default_branch committed_count pull_request_creation_eligible dirty
    }
    worktrees {
      kind task_id pull_request_state
      pull_request { url state replacement_eligible follow_up_eligible reason }
    }
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

fn commit_file(checkout: &Path, name: &str) {
    write(&checkout.join(name), "committed\n");
    git(&["add", name], checkout);
    git(&["commit", "-m", "committed work"], checkout);
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

struct FakeGithub {
    _directory: tempfile::TempDir,
    executable: PathBuf,
    mode: PathBuf,
    view: PathBuf,
    checks: PathBuf,
    create_url: PathBuf,
    log: PathBuf,
}

impl FakeGithub {
    fn new() -> Self {
        let directory = tempfile::tempdir().expect("create fake GitHub client");
        let executable = directory.path().join("gh");
        let mode = directory.path().join("mode");
        let view = directory.path().join("view.json");
        let checks = directory.path().join("checks.json");
        let create_url = directory.path().join("create-url");
        let log = directory.path().join("calls.log");
        write(
            &executable,
            r#"#!/bin/sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' "$*" >> "$DIR/calls.log"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  case "$(cat "$DIR/mode")" in
    unavailable|auth_failure|rate_limit|transport) printf '%s\n' 'provider unavailable' >&2; exit 1 ;;
    malformed) printf '%s\n' '{not-json'; exit 0 ;;
    *) cat "$DIR/view.json"; exit 0 ;;
  esac
fi
if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then
  if [ "$(cat "$DIR/mode")" = "no_required_checks" ]; then
    printf '%s\n' 'no required checks reported on the "main" branch' >&2
    exit 1
  fi
  if [ "$(cat "$DIR/mode")" = "malformed_checks" ]; then
    printf '%s\n' '{not-json'
    exit 0
  fi
  cat "$DIR/checks.json"
  exit 0
fi
case "$(cat "$DIR/mode")" in
  success) cat "$DIR/create-url"; exit 0 ;;
  uncertain) printf '%s\n' 'request accepted without a URL'; exit 0 ;;
  *) printf '%s\n' 'provider rejected request' >&2; exit 1 ;;
esac
"#,
        );
        let mut permissions = std::fs::metadata(&executable)
            .expect("read fake gh metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("make fake gh executable");
        write(&mode, "success\n");
        write(
            &view,
            r#"{"state":"OPEN","baseRefName":"main","headRefOid":"0000000000000000000000000000000000000000","mergeable":"MERGEABLE","reviewDecision":"APPROVED"}"#,
        );
        write(&checks, "[]\n");
        write(
            &create_url,
            "https://github.com/ticketry-hq/ticketry/pull/1324\n",
        );
        Self {
            _directory: directory,
            executable,
            mode,
            view,
            checks,
            create_url,
            log,
        }
    }

    fn select(&self, mode: &str) {
        write(&self.mode, mode);
    }

    fn set_view(&self, view: serde_json::Value) {
        write(&self.view, &view.to_string());
    }

    fn set_checks(&self, checks: serde_json::Value) {
        write(&self.checks, &checks.to_string());
    }

    fn set_create_url(&self, url: &str) {
        write(&self.create_url, &format!("{url}\n"));
    }

    fn calls(&self) -> String {
        std::fs::read_to_string(&self.log).unwrap_or_default()
    }
}

#[tokio::test]
async fn mapped_pull_request_provider_failure_is_unavailable_and_preserves_the_mapping() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let _remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "mapped.txt");

    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");

    for mode in [
        "auth_failure",
        "rate_limit",
        "transport",
        "malformed",
        "malformed_checks",
    ] {
        github.select(mode);
        let unavailable = task
            .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
            .await;
        assert_eq!(
            unavailable["data"]["worktree_changes"]["pull_request_url"],
            "https://github.com/ticketry-hq/ticketry/pull/1324"
        );
        let status = &unavailable["data"]["worktree_changes"]["pull_request"];
        assert_eq!(
            status["url"],
            "https://github.com/ticketry-hq/ticketry/pull/1324"
        );
        assert_eq!(status["state"], "unavailable", "mode {mode}");
        assert_eq!(status["integrated"], false);
        assert_eq!(status["replacement_eligible"], false);
        assert_eq!(status["follow_up_eligible"], false);
        assert_eq!(status["merge_preparation_eligible"], false);
        assert!(status["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty()));
    }
    assert!(github.calls().contains("pr view"));
}

struct ApprovedGithubPath;

impl ApprovedGithubPath {
    fn set(path: &Path) -> Self {
        unsafe { std::env::set_var("MUXED_APPROVED_GH_PATH", path) };
        Self
    }
}

impl Drop for ApprovedGithubPath {
    fn drop(&mut self) {
        unsafe { std::env::remove_var("MUXED_APPROVED_GH_PATH") };
    }
}

fn operation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn error_code(response: &serde_json::Value) -> &str {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .expect("structured error code")
}

async fn pull_request_status(task: &support::Fixture) -> serde_json::Value {
    let response = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    response["data"]["worktree_changes"]["pull_request"].clone()
}

async fn work_item_state(task: &support::Fixture) -> String {
    let response = task
        .graphql(WORK_ITEM_STATE, serde_json::json!({"id": TASK}))
        .await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    response["data"]["worktrackerIssue"]["nodes"][0]["state"]["name"]
        .as_str()
        .expect("Work Item state name")
        .to_owned()
}

#[tokio::test]
async fn owning_ticket_load_reconciles_a_correct_base_merge_but_module_list_read_does_not() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let _remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "merged.txt");
    let merged_head = git(&["rev-parse", "HEAD"], task.checkout_path());
    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    github.set_view(serde_json::json!({
        "state": "MERGED",
        "baseRefName": "main",
        "headRefOid": merged_head,
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));

    let listed = task
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    assert_eq!(listed["errors"], serde_json::Value::Null, "{listed:#}");
    assert_eq!(work_item_state(&task).await, "Backlog");

    let loaded = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(loaded["errors"], serde_json::Value::Null, "{loaded:#}");
    let changes = &loaded["data"]["worktree_changes"];
    assert_eq!(changes["pull_request"]["integrated"], true);
    assert_eq!(changes["work_item_done"], true);
    assert_eq!(changes["closure_failure"], serde_json::Value::Null);
    assert_eq!(changes["cleanup"]["eligible"], true);
    assert_eq!(work_item_state(&task).await, "Done");
}

#[tokio::test]
async fn confirmed_cleanup_removes_only_local_task_state_and_requires_confirmation() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "cleanup.txt");
    let merged_head = git(&["rev-parse", "HEAD"], task.checkout_path());
    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    github.set_view(serde_json::json!({
        "state": "MERGED",
        "baseRefName": "main",
        "headRefOid": merged_head,
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));
    let loaded = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        loaded["data"]["worktree_changes"]["cleanup"]["eligible"],
        true
    );

    let operation_id = operation_id();
    let unconfirmed = task
        .graphql(
            CLEANUP_WORKTREE,
            serde_json::json!({
                "taskId": TASK,
                "operationId": operation_id,
                "confirmed": false,
            }),
        )
        .await;
    assert_eq!(
        error_code(&unconfirmed),
        "worktree_cleanup_confirmation_required"
    );
    assert!(task.checkout_path().exists());
    assert!(task.row_exists().await);
    assert!(task.branch_exists());

    let cleaned = task
        .graphql(
            CLEANUP_WORKTREE,
            serde_json::json!({
                "taskId": TASK,
                "operationId": operation_id,
                "confirmed": true,
            }),
        )
        .await;
    assert_eq!(cleaned["errors"], serde_json::Value::Null, "{cleaned:#}");
    let result = &cleaned["data"]["worktree_cleanup"];
    assert_eq!(result["removed"], true);
    assert_eq!(result["branch"], BRANCH);
    assert_eq!(result["status"]["kind"], "none");
    assert!(!task.checkout_path().exists());
    assert!(!task.row_exists().await);
    assert!(!task.branch_exists());
    assert_eq!(git(&["rev-parse", BRANCH], &remote.bare), merged_head);
    let calls = github.calls();
    assert!(!calls.contains("pr close"));
    assert!(!calls.contains("pr delete"));
}

#[tokio::test]
async fn closure_refusal_and_every_cleanup_blocker_remain_separate_live_facts() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let _remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "lifecycle.txt");
    let merged_head = git(&["rev-parse", "HEAD"], task.checkout_path());
    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    let provider = |state: &str, base: &str, head: &str| {
        serde_json::json!({
            "state": state,
            "baseRefName": base,
            "headRefOid": head,
            "mergeable": "MERGEABLE",
            "reviewDecision": "APPROVED",
        })
    };

    task.set_transition_agent_allowed(false).await;
    github.set_view(provider("MERGED", "main", &merged_head));
    let refused = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    let changes = &refused["data"]["worktree_changes"];
    assert_eq!(changes["pull_request"]["integrated"], true);
    assert_eq!(changes["work_item_done"], false);
    assert_eq!(changes["closure_failure"]["code"], "human_only_transition");
    assert_eq!(changes["closure_failure"]["from_state"], "Backlog");
    assert_eq!(changes["closure_failure"]["to_state"], "Done");
    assert_eq!(changes["cleanup"]["blocker"], "work_item_not_done");
    assert!(task.checkout_path().exists());

    task.complete().await;
    assert_eq!(work_item_state(&task).await, "Done");

    github.select("unavailable");
    assert_cleanup_blocker(&task, "pull_request_unavailable").await;
    github.select("success");
    github.set_view(provider("OPEN", "main", &merged_head));
    assert_cleanup_blocker(&task, "pull_request_not_merged").await;
    github.set_view(provider("CLOSED", "main", &merged_head));
    assert_cleanup_blocker(&task, "pull_request_closed_unmerged").await;
    github.set_view(provider("MERGED", "release", &merged_head));
    assert_cleanup_blocker(&task, "pull_request_wrong_base").await;
    github.set_view(provider("MERGED", "main", &merged_head));

    write(&task.checkout_path().join("dirty.txt"), "uncommitted\n");
    assert_cleanup_blocker(&task, "checkout_dirty").await;
    std::fs::remove_file(task.checkout_path().join("dirty.txt")).expect("clean fixture checkout");

    commit_file(task.checkout_path(), "post-merge.txt");
    assert_cleanup_blocker(&task, "post_merge_work").await;

    let module_cleanup = task
        .graphql(
            CLEANUP_WORKTREE,
            serde_json::json!({
                "taskId": MODULE,
                "operationId": operation_id(),
                "confirmed": true,
            }),
        )
        .await;
    assert_eq!(error_code(&module_cleanup), "worktree_work_item_invalid");
}

async fn assert_cleanup_blocker(task: &support::Fixture, blocker: &str) {
    let response = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    let cleanup = &response["data"]["worktree_changes"]["cleanup"];
    assert_eq!(cleanup["eligible"], false);
    assert_eq!(cleanup["blocker"], blocker);
    assert!(cleanup["reason"]
        .as_str()
        .is_some_and(|reason| !reason.is_empty()));
}

#[tokio::test]
async fn merge_squash_and_rebase_fixtures_use_the_reviewed_head_not_target_ancestry() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);

    for strategy in ["merge", "squash", "rebase"] {
        let task = fixture(Scenario::Clean).await;
        let _remote = attach_remote(task.repository_path());
        commit_file(task.checkout_path(), &format!("{strategy}-reviewed.txt"));
        let reviewed_head = git(&["rev-parse", "HEAD"], task.checkout_path());
        let created = task
            .graphql(
                TASK_PULL_REQUEST,
                serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
            )
            .await;
        assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");

        commit_file(task.repository_path(), &format!("{strategy}-base-side.txt"));
        match strategy {
            "merge" => {
                git(
                    &["merge", "--no-ff", BRANCH, "-m", "merge reviewed work"],
                    task.repository_path(),
                );
            }
            "squash" => {
                git(&["merge", "--squash", BRANCH], task.repository_path());
                git(
                    &["commit", "-m", "squash reviewed work"],
                    task.repository_path(),
                );
            }
            "rebase" => {
                git(&["cherry-pick", &reviewed_head], task.repository_path());
            }
            _ => unreachable!(),
        }
        assert_ne!(
            git(&["rev-parse", "HEAD"], task.repository_path()),
            reviewed_head,
            "{strategy} target identity must differ from the reviewed branch head"
        );

        github.set_view(serde_json::json!({
            "state": "MERGED",
            "baseRefName": "main",
            "headRefOid": reviewed_head,
            "mergeable": "MERGEABLE",
            "reviewDecision": "APPROVED",
        }));
        let unchanged = task
            .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
            .await;
        assert_eq!(
            unchanged["data"]["worktree_changes"]["cleanup"]["eligible"], true,
            "{strategy}"
        );

        commit_file(task.checkout_path(), &format!("{strategy}-after-merge.txt"));
        assert_cleanup_blocker(&task, "post_merge_work").await;
    }
}

#[tokio::test]
async fn partial_cleanup_failure_is_structured_and_the_same_operation_can_recover() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "recoverable-cleanup.txt");
    let merged_head = git(&["rev-parse", "HEAD"], task.checkout_path());
    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    github.set_view(serde_json::json!({
        "state": "MERGED",
        "baseRefName": "main",
        "headRefOid": merged_head,
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));
    let loaded = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        loaded["data"]["worktree_changes"]["cleanup"]["eligible"],
        true
    );

    let hook = task
        .repository_path()
        .join(".git/hooks/reference-transaction");
    write(&hook, "#!/bin/sh\n[ \"$1\" != \"prepared\" ]\n");
    let mut permissions = std::fs::metadata(&hook)
        .expect("read hook metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&hook, permissions).expect("make hook executable");

    let operation_id = operation_id();
    let failed = task
        .graphql(
            CLEANUP_WORKTREE,
            serde_json::json!({
                "taskId": TASK,
                "operationId": operation_id,
                "confirmed": true,
            }),
        )
        .await;
    assert_eq!(error_code(&failed), "worktree_git_failed");
    assert_eq!(failed["errors"][0]["extensions"]["retryable"], true);
    assert!(!task.checkout_path().exists());
    assert!(task.row_exists().await);
    assert!(task.branch_exists());
    assert_eq!(git(&["rev-parse", BRANCH], &remote.bare), merged_head);

    std::fs::remove_file(hook).expect("remove rejecting hook");
    let recovered = task
        .graphql(
            CLEANUP_WORKTREE,
            serde_json::json!({
                "taskId": TASK,
                "operationId": operation_id,
                "confirmed": true,
            }),
        )
        .await;
    assert_eq!(
        recovered["errors"],
        serde_json::Value::Null,
        "{recovered:#}"
    );
    assert_eq!(recovered["data"]["worktree_cleanup"]["removed"], true);
    assert!(!task.row_exists().await);
    assert!(!task.branch_exists());
}

#[tokio::test]
async fn mapped_pull_request_reads_classify_every_approved_provider_state_live() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);
    let task = fixture(Scenario::Clean).await;
    let _remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "mapped-states.txt");
    let merged_head = git(&["rev-parse", "HEAD"], task.checkout_path());
    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");

    let view = |state: &str, base: &str, mergeable: &str, review: Option<&str>| {
        serde_json::json!({
            "state": state,
            "baseRefName": base,
            "headRefOid": merged_head,
            "mergeable": mergeable,
            "reviewDecision": review,
        })
    };

    github.set_view(view("OPEN", "main", "MERGEABLE", Some("APPROVED")));
    github.select("no_required_checks");
    assert_eq!(pull_request_status(&task).await["state"], "ready");
    github.select("success");

    github.set_view(view("OPEN", "main", "MERGEABLE", Some("")));
    github.set_checks(serde_json::json!([]));
    assert_eq!(pull_request_status(&task).await["state"], "ready");

    github.set_view(view("OPEN", "main", "CONFLICTING", Some("APPROVED")));
    let conflict = pull_request_status(&task).await;
    assert_eq!(conflict["state"], "merge_conflict");
    assert_eq!(conflict["merge_preparation_eligible"], true);

    github.set_view(view("OPEN", "main", "MERGEABLE", Some("APPROVED")));
    github.set_checks(serde_json::json!([{"bucket": "fail"}]));
    let failed = pull_request_status(&task).await;
    assert_eq!(failed["state"], "checks_failed");
    assert_eq!(failed["merge_preparation_eligible"], true);

    github.set_checks(serde_json::json!([{"bucket": "pending"}]));
    let pending = pull_request_status(&task).await;
    assert_eq!(pending["state"], "checks_pending");
    assert_eq!(pending["merge_preparation_eligible"], false);

    github.set_checks(serde_json::json!([{"bucket": "pass"}]));
    github.set_view(view("OPEN", "main", "UNKNOWN", Some("REVIEW_REQUIRED")));
    assert_eq!(
        pull_request_status(&task).await["state"],
        "approval_required"
    );

    github.set_view(view("OPEN", "main", "UNKNOWN", Some("APPROVED")));
    assert_eq!(
        pull_request_status(&task).await["state"],
        "mergeability_pending"
    );

    github.set_view(view("OPEN", "main", "MERGEABLE", Some("REVIEW_REQUIRED")));
    let approval = pull_request_status(&task).await;
    assert_eq!(approval["state"], "approval_required");
    assert_eq!(approval["merge_preparation_eligible"], false);

    github.set_view(view("MERGED", "release", "MERGEABLE", Some("APPROVED")));
    let wrong_base = pull_request_status(&task).await;
    assert_eq!(wrong_base["state"], "wrong_base");
    assert_eq!(wrong_base["target_branch"], "release");
    assert_eq!(wrong_base["integrated"], false);

    github.set_view(view("MERGED", "main", "MERGEABLE", Some("APPROVED")));
    let merged = pull_request_status(&task).await;
    assert_eq!(merged["state"], "merged");
    assert_eq!(merged["integrated"], true);
    assert_eq!(merged["head_commit"], merged_head);
    assert_eq!(merged["post_merge_work"], false);

    commit_file(task.checkout_path(), "follow-up.txt");
    let post_merge = pull_request_status(&task).await;
    assert_eq!(post_merge["state"], "merged");
    assert_eq!(post_merge["post_merge_work"], true);
    assert_eq!(post_merge["follow_up_eligible"], true);

    github.set_view(view("CLOSED", "main", "MERGEABLE", Some("APPROVED")));
    let closed = pull_request_status(&task).await;
    assert_eq!(closed["state"], "closed_unmerged");
    assert_eq!(closed["replacement_eligible"], true);
    assert_eq!(closed["integrated"], false);

    github.set_view(view("CLOSED", "release", "MERGEABLE", Some("APPROVED")));
    let retargeted_closed = pull_request_status(&task).await;
    assert_eq!(retargeted_closed["state"], "closed_unmerged");
    assert_eq!(retargeted_closed["replacement_eligible"], true);

    git(
        &[
            "worktree",
            "remove",
            "--force",
            task.checkout_path().to_str().unwrap(),
        ],
        task.repository_path(),
    );
    github.set_view(view("OPEN", "main", "MERGEABLE", Some("APPROVED")));
    github.set_checks(serde_json::json!([]));
    let module = task
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    assert_eq!(module["errors"], serde_json::Value::Null, "{module:#}");
    let mapped = module["data"]["module_version_control"]["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["task_id"] == TASK)
        .unwrap();
    assert_eq!(mapped["pull_request"]["state"], "ready");

    assert!(github.calls().matches("pr view").count() >= 9);
    assert!(github.calls().contains("pr checks"));
}

#[tokio::test]
async fn closed_and_post_merge_work_can_replace_the_single_mapping() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);

    let closed_task = fixture(Scenario::Clean).await;
    let _closed_remote = attach_remote(closed_task.repository_path());
    commit_file(closed_task.checkout_path(), "closed.txt");
    let created = closed_task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    let closed_head = git(&["rev-parse", "HEAD"], closed_task.checkout_path());
    github.set_view(serde_json::json!({
        "state": "CLOSED",
        "baseRefName": "main",
        "headRefOid": closed_head,
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));
    github.set_create_url("https://github.com/ticketry-hq/ticketry/pull/1325");
    let replaced = closed_task
        .graphql(
            REPLACE_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(replaced["errors"], serde_json::Value::Null, "{replaced:#}");
    assert_eq!(
        replaced["data"]["worktree_pull_request_replace"]["url"],
        "https://github.com/ticketry-hq/ticketry/pull/1325"
    );

    let follow_up_task = fixture(Scenario::Clean).await;
    let _follow_up_remote = attach_remote(follow_up_task.repository_path());
    commit_file(follow_up_task.checkout_path(), "merged.txt");
    github.set_create_url("https://github.com/ticketry-hq/ticketry/pull/1326");
    let initial = follow_up_task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(initial["errors"], serde_json::Value::Null, "{initial:#}");
    let merged_head = git(&["rev-parse", "HEAD"], follow_up_task.checkout_path());
    github.set_view(serde_json::json!({
        "state": "MERGED",
        "baseRefName": "main",
        "headRefOid": merged_head,
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));
    commit_file(follow_up_task.checkout_path(), "after-merge.txt");
    github.set_create_url("https://github.com/ticketry-hq/ticketry/pull/1327");
    let followed_up = follow_up_task
        .graphql(
            FOLLOW_UP_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(
        followed_up["errors"],
        serde_json::Value::Null,
        "{followed_up:#}"
    );
    assert_eq!(
        followed_up["data"]["worktree_pull_request_follow_up"]["url"],
        "https://github.com/ticketry-hq/ticketry/pull/1327"
    );

    let calls = github.calls();
    assert!(!calls.contains("pr close"));
    assert!(!calls.contains("pr delete"));
}

#[tokio::test]
async fn graphql_creates_only_eligible_confirmed_pull_requests() {
    let _github_env = GITHUB_ENV.lock().expect("lock fake GitHub path");
    let github = FakeGithub::new();
    let _approved_path = ApprovedGithubPath::set(&github.executable);

    let task = fixture(Scenario::Clean).await;
    let task_remote = attach_remote(task.repository_path());
    commit_file(task.checkout_path(), "task-commit.txt");
    write(&task.checkout_path().join("dirty.txt"), "stay local\n");
    let dirty_before = git(&["status", "--porcelain=v1"], task.checkout_path());

    let created = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(created["errors"], serde_json::Value::Null, "{created:#}");
    let result = &created["data"]["worktree_pull_request_create"];
    assert_eq!(
        result["url"],
        "https://github.com/ticketry-hq/ticketry/pull/1324"
    );
    assert_eq!(result["branch"], BRANCH);
    assert_eq!(result["base_branch"], "main");
    assert_eq!(result["pushed"], true);
    assert_eq!(result["uncommitted_work_excluded"], true);
    assert_eq!(
        git(&["status", "--porcelain=v1"], task.checkout_path()),
        dirty_before
    );
    assert_eq!(
        git(&["rev-parse", BRANCH], &task_remote.bare),
        git(&["rev-parse", "HEAD"], task.checkout_path())
    );
    let mapped = task
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        mapped["data"]["worktree_changes"]["pull_request_url"],
        "https://github.com/ticketry-hq/ticketry/pull/1324"
    );
    assert_eq!(
        mapped["data"]["worktree_changes"]["pull_request_creation_eligible"],
        false
    );

    let calls_after_success = github.calls();
    assert!(calls_after_success.contains(&format!("pr create --base main --head {BRANCH}")));
    let duplicate = task
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(
        error_code(&duplicate),
        "worktree_pull_request_already_mapped"
    );
    assert_eq!(github.calls(), calls_after_success);

    let failed = fixture(Scenario::Clean).await;
    let _failed_remote = attach_remote(failed.repository_path());
    commit_file(failed.checkout_path(), "provider-failure.txt");
    github.select("rejected");
    let rejected = failed
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(error_code(&rejected), "github_pull_request_rejected");
    let unmapped = failed
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        unmapped["data"]["worktree_changes"]["pull_request_url"],
        serde_json::Value::Null
    );

    github.select("uncertain");
    let uncertain = failed
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(
        error_code(&uncertain),
        "github_pull_request_response_unavailable"
    );
    let still_unmapped = failed
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        still_unmapped["data"]["worktree_changes"]["pull_request_url"],
        serde_json::Value::Null
    );

    github.select("success");
    let retried = failed
        .graphql(
            TASK_PULL_REQUEST,
            serde_json::json!({"taskId": TASK, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(retried["errors"], serde_json::Value::Null, "{retried:#}");
    assert_eq!(
        retried["data"]["worktree_pull_request_create"]["pushed"],
        false
    );

    let module = fixture(Scenario::Clean).await;
    let module_remote = attach_remote(module.repository_path());
    git(
        &["checkout", "-b", "feature/module-pr"],
        module.repository_path(),
    );
    commit_file(module.repository_path(), "module-commit.txt");
    write(
        &module.repository_path().join("module-dirty.txt"),
        "stay local\n",
    );
    let module_before = module
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    let checkout = &module_before["data"]["module_version_control"]["checkout"];
    assert_eq!(checkout["default_branch"], "main");
    assert_eq!(checkout["pull_request_creation_eligible"], true);

    let module_created = module
        .graphql(
            MODULE_PULL_REQUEST,
            serde_json::json!({"moduleId": MODULE, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(
        module_created["errors"],
        serde_json::Value::Null,
        "{module_created:#}"
    );
    let module_result = &module_created["data"]["module_checkout_pull_request_create"];
    assert_eq!(module_result["branch"], "feature/module-pr");
    assert_eq!(module_result["base_branch"], "main");
    assert_eq!(module_result["pushed"], true);
    assert_eq!(module_result["uncommitted_work_excluded"], true);
    assert_eq!(
        git(&["rev-parse", "feature/module-pr"], &module_remote.bare),
        git(&["rev-parse", "HEAD"], module.repository_path())
    );
    let task_mapping = module
        .graphql(TASK_CHANGES, serde_json::json!({"taskId": TASK}))
        .await;
    assert_eq!(
        task_mapping["data"]["worktree_changes"]["pull_request_url"],
        serde_json::Value::Null
    );

    github.set_view(serde_json::json!({
        "state": "OPEN",
        "baseRefName": "main",
        "headRefOid": "0000000000000000000000000000000000000000",
        "mergeable": "MERGEABLE",
        "reviewDecision": "APPROVED",
    }));
    github.set_checks(serde_json::json!([]));
    let task_module = task
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    assert_eq!(
        task_module["errors"],
        serde_json::Value::Null,
        "{task_module:#}"
    );
    let task_row = &task_module["data"]["module_version_control"]["worktrees"][1];
    assert_eq!(task_row["pull_request_state"], "ready");
    assert_eq!(
        task_row["pull_request"]["url"],
        "https://github.com/ticketry-hq/ticketry/pull/1324"
    );

    git(&["checkout", "main"], module.repository_path());
    let default_branch = module
        .graphql(MODULE_CHANGES, serde_json::json!({"moduleId": MODULE}))
        .await;
    assert_eq!(
        default_branch["data"]["module_version_control"]["checkout"]
            ["pull_request_creation_eligible"],
        false
    );
    let ineligible = module
        .graphql(
            MODULE_PULL_REQUEST,
            serde_json::json!({"moduleId": MODULE, "operationId": operation_id()}),
        )
        .await;
    assert_eq!(
        error_code(&ineligible),
        "module_pull_request_ineligible_branch"
    );

    let calls = github.calls();
    assert!(!calls.contains("pr list"));
    assert!(calls.contains("pr view"));
}
