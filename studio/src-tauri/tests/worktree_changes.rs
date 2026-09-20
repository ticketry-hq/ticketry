//! Cumulative task-worktree changes through the public GraphQL query.

use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::initialize_with_worktracker_commands_and_install;

#[path = "worktree_changes/destination_recency.rs"]
mod destination_recency;

#[path = "worktree_changes/merge_options.rs"]
mod merge_options;

#[path = "worktree_changes/source_merge_recovery.rs"]
mod source_merge_recovery;

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
const MODULE_PUBLIC: &str = "20000000-0000-0000-0000-000000000001";
const TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";

const CHANGES_QUERY: &str = r#"query($taskId: String!) {
    worktree_changes(task_id: $taskId) {
    task_id
    top_level_task_id
    is_shared
    base_commit
      truncated
      files {
        path
        previous_path
        status
        binary
        insertions
        deletions
      }
      insertions
      deletions
    }
}"#;

const STATUS_AND_CHANGES_QUERY: &str = r#"query($taskId: String!) {
  worktree_status(task_id: $taskId) { dirty }
  worktree_changes(task_id: $taskId) {
    files { path previous_path status }
  }
}"#;

const FILE_DIFF_QUERY: &str = r#"query($taskId: String!, $path: String!) {
  worktree_file_diff(task_id: $taskId, path: $path) {
    path status binary patch truncated
  }
}"#;

const MODULE_VERSION_CONTROL_QUERY: &str = r#"query($moduleId: String!) {
  module_version_control(module_id: $moduleId) {
    module_id
    checkout { available branch baseline baseline_kind clean dirty unpushed_count files { path status } }
    worktrees_truncated
    worktrees {
      kind task_id task_key task_name branch available clean dirty
      unpushed_count pull_request_state reason
    }
  }
}"#;

const MERGE_PREVIEW_QUERY: &str = r#"query($taskId: String!, $destinationBranch: String) {
  worktree_merge_preview(task_id: $taskId, destination_branch: $destinationBranch) {
    source_branch source_commit destination_branch destination_commit destination_checkout confirmation_token ready blocker reason
    requires_destination_selection
    destinations { branch checkout }
  }
}"#;

const MERGE_MUTATION: &str = r#"mutation(
  $taskId: String!, $operationId: String!, $destinationBranch: String!, $confirmationToken: String!
  ) {
  worktree_merge(
    task_id: $taskId
    operation_id: $operationId
    destination_branch: $destinationBranch
    confirmation_token: $confirmationToken
  ) {
    operation_id outcome source_branch source_commit destination_branch destination_commit
    destination_checkout unmerged_paths { path }
  }
}"#;

const FINISH_MERGE_MUTATION: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_merge_finish(task_id: $taskId, operation_id: $operationId) {
    operation_id outcome source_commit destination_commit destination_checkout
    unmerged_paths { path }
  }
}"#;

const ABORT_MERGE_MUTATION: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_merge_abort(task_id: $taskId, operation_id: $operationId) {
    operation_id outcome source_commit destination_commit destination_checkout
    unmerged_paths { path }
  }
}"#;

const MERGE_RECOVERY_QUERY: &str = r#"query($taskId: String!) {
  worktree_merge_recovery(task_id: $taskId) {
    operation_id outcome source_commit destination_commit destination_checkout
    unmerged_paths { path }
  }
}"#;

fn git(arguments: &[&str], working_directory: &Path) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Ticketry Test")
        .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
        .env("GIT_COMMITTER_NAME", "Ticketry Test")
        .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        arguments,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent directory");
    }
    std::fs::write(path, contents).expect("write fixture file");
}

fn repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    write(&root.join("README.md"), "base\n");
    write(&root.join("src/unstaged.rs"), "pub fn before() {}\n");
    write(&root.join("deleted.txt"), "delete me\n");
    write(
        &root.join("rename-old.txt"),
        "rename me with enough content\n",
    );
    write(
        &root.join("copy-source.txt"),
        "copy me with enough unique content for detection\n",
    );
    write(&root.join("conflict.txt"), "common base\n");
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);
    git(&["rev-parse", "HEAD"], root)
}

async fn link_module(database: &DatabaseConnection, folder: &Path) {
    ticketry_work_management::schema::install(database)
        .await
        .expect("install the Module Link schema");
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &folder.display().to_string())
        .await
        .expect("link the fixture module");
}

struct Fixture {
    _directory: tempfile::TempDir,
    api: TransportApiImpl,
    checkout: PathBuf,
    base_commit: String,
}

impl Fixture {
    async fn merge_preview(&self, destination_branch: Option<&str>) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": MERGE_PREVIEW_QUERY,
                    "variables": {
                        "taskId": TASK,
                        "destinationBranch": destination_branch,
                    },
                })
                .to_string(),
            )
            .await;
        let response: serde_json::Value =
            serde_json::from_str(&response).expect("decode merge preview response");
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_merge_preview"].clone()
    }

    async fn merge(&self, operation_id: &str, preview: &serde_json::Value) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": MERGE_MUTATION,
                    "variables": {
                        "taskId": TASK,
                        "operationId": operation_id,
                        "destinationBranch": preview["destination_branch"],
                        "confirmationToken": preview["confirmation_token"],
                    },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode worktree merge response")
    }

    async fn finish_merge(&self, operation_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": FINISH_MERGE_MUTATION,
                    "variables": { "taskId": TASK, "operationId": operation_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode finish merge response")
    }

    async fn abort_merge(&self, operation_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": ABORT_MERGE_MUTATION,
                    "variables": { "taskId": TASK, "operationId": operation_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode abort merge response")
    }

    async fn merge_recovery(&self) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": MERGE_RECOVERY_QUERY,
                    "variables": { "taskId": TASK },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode merge recovery response")
    }

    async fn response(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": CHANGES_QUERY,
                    "variables": { "taskId": task_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode worktree changes response")
    }

    async fn changes(&self, task_id: &str) -> serde_json::Value {
        let response = self.response(task_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_changes"].clone()
    }

    async fn status_and_changes(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": STATUS_AND_CHANGES_QUERY,
                    "variables": { "taskId": task_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode status and changes response")
    }

    async fn module_version_control(&self) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": MODULE_VERSION_CONTROL_QUERY,
                    "variables": { "moduleId": MODULE_PUBLIC },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode module version-control response")
    }

    async fn execute(&self, statement: &str) {
        let database = Database::connect(format!(
            "sqlite:{}?mode=rw",
            self._directory.path().join("state.db").display()
        ))
        .await
        .expect("open fixture database");
        database
            .execute_unprepared(statement)
            .await
            .expect("mutate fixture state");
    }
}

#[tokio::test]
async fn merge_preview_reports_the_recorded_local_destination_without_writing_git() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture._directory.path().join("repositories/ticketry");
    let refs_before = git(&["show-ref"], &repository);
    let source_head_before = git(&["rev-parse", "HEAD"], &fixture.checkout);
    let destination_head_before = git(&["rev-parse", "HEAD"], &repository);
    let status_before = git(&["status", "--porcelain"], &repository);

    let preview = fixture.merge_preview(None).await;

    assert_eq!(preview["source_branch"], "wt/CODIN-881-task");
    assert_eq!(preview["source_commit"], source_head_before);
    assert_eq!(preview["destination_branch"], "main");
    assert_eq!(preview["destination_commit"], destination_head_before);
    assert_eq!(
        preview["destination_checkout"],
        repository
            .canonicalize()
            .expect("canonical repository")
            .display()
            .to_string()
    );
    assert_eq!(preview["ready"], true);
    assert_eq!(preview["blocker"], serde_json::Value::Null);
    assert_eq!(preview["requires_destination_selection"], false);
    assert_eq!(git(&["show-ref"], &repository), refs_before);
    assert_eq!(
        git(&["rev-parse", "HEAD"], &fixture.checkout),
        source_head_before
    );
    assert_eq!(
        git(&["rev-parse", "HEAD"], &repository),
        destination_head_before
    );
    assert_eq!(git(&["status", "--porcelain"], &repository), status_before);
}

#[tokio::test]
async fn confirmed_fast_forward_is_idempotent_and_preserves_both_checkouts() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture._directory.path().join("repositories/ticketry");
    let preview = fixture.merge_preview(None).await;
    let operation_id = "90000000-0000-0000-0000-000000000001";

    let first = fixture.merge(operation_id, &preview).await;
    assert_eq!(first["errors"], serde_json::Value::Null, "{first}");
    let result = &first["data"]["worktree_merge"];
    assert_eq!(result["outcome"], "fast_forwarded");
    assert_eq!(result["destination_commit"], preview["source_commit"]);
    assert_eq!(
        git(&["rev-parse", "HEAD"], &repository),
        preview["source_commit"]
    );
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    assert_eq!(git(&["status", "--porcelain"], &fixture.checkout), "");
    assert!(fixture.checkout.is_dir());
    assert_eq!(
        git(&["rev-parse", "wt/CODIN-881-task"], &repository),
        preview["source_commit"]
    );

    let repeated = fixture.merge(operation_id, &preview).await;
    assert_eq!(repeated["errors"], serde_json::Value::Null, "{repeated}");
    assert_eq!(repeated["data"]["worktree_merge"], *result);
}

#[tokio::test]
async fn confirmed_divergence_creates_and_verifies_a_merge_commit() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("destination.txt"), "destination work\n");
    git(&["add", "."], &repository);
    git(&["commit", "-m", "destination work"], &repository);
    write(&fixture.checkout.join("source.txt"), "source work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "source work"], &fixture.checkout);
    let preview = fixture.merge_preview(None).await;
    let source_before = git(&["rev-parse", "HEAD"], &fixture.checkout);
    let destination_before = git(&["rev-parse", "HEAD"], &repository);

    let response = fixture
        .merge("90000000-0000-0000-0000-000000000010", &preview)
        .await;

    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    assert_eq!(response["data"]["worktree_merge"]["outcome"], "merged");
    let merged = git(&["rev-parse", "HEAD"], &repository);
    assert_ne!(merged, source_before);
    assert_ne!(merged, destination_before);
    assert_eq!(
        git(&["rev-list", "--parents", "-n", "1", "HEAD"], &repository),
        format!("{merged} {destination_before} {source_before}")
    );
    git(
        &["merge-base", "--is-ancestor", &source_before, &merged],
        &repository,
    );
    assert_eq!(
        git(&["rev-parse", "--verify", "HEAD"], &fixture.checkout),
        source_before
    );
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    assert!(!PathBuf::from(git(&["rev-parse", "--git-path", "MERGE_HEAD"], &repository)).exists());
}

#[tokio::test]
async fn divergent_conflict_returns_recoverable_destination_and_unmerged_paths() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["ready"], true, "{preview}");

    let response = fixture
        .merge("90000000-0000-0000-0000-000000000011", &preview)
        .await;

    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    let result = &response["data"]["worktree_merge"];
    assert_eq!(result["outcome"], "conflicted");
    assert_eq!(
        result["destination_checkout"],
        repository.canonicalize().unwrap().display().to_string()
    );
    assert_eq!(
        result["unmerged_paths"],
        serde_json::json!([{ "path": "conflict.txt" }])
    );
    assert_eq!(
        git(&["rev-parse", "--verify", "MERGE_HEAD"], &repository),
        preview["source_commit"].as_str().unwrap()
    );
    assert_eq!(
        git(&["diff", "--name-only", "--diff-filter=U"], &repository),
        "conflict.txt"
    );
}

#[tokio::test]
async fn expired_leased_conflict_remains_recoverable_for_finish_and_abort() {
    for (operation_id, finish) in [
        ("90000000-0000-0000-0000-000000000018", true),
        ("90000000-0000-0000-0000-000000000019", false),
    ] {
        let fixture = fixture().await;
        let repository = fixture._directory.path().join("repositories/ticketry");
        write(&repository.join("conflict.txt"), "destination side\n");
        git(&["commit", "-am", "destination side"], &repository);
        write(&fixture.checkout.join("conflict.txt"), "source side\n");
        git(&["commit", "-am", "source side"], &fixture.checkout);
        let preview = fixture.merge_preview(None).await;
        let conflicted = fixture.merge(operation_id, &preview).await;
        assert_eq!(
            conflicted["data"]["worktree_merge"]["outcome"],
            "conflicted"
        );

        fixture
            .execute(&format!(
                "UPDATE workspace_operations
                 SET state='leased', lease_owner='lost-worker',
                     lease_expires_at='2000-01-01 00:00:00', settled_at=NULL,
                     evidence=NULL, result_summary=NULL
                 WHERE operation_id='{}'",
                operation_id.replace('-', "")
            ))
            .await;

        let retried = fixture.merge(operation_id, &preview).await;
        assert_eq!(retried["errors"], serde_json::Value::Null, "{retried}");
        assert_eq!(retried["data"]["worktree_merge"]["outcome"], "conflicted");
        let recovery = fixture.merge_recovery().await;
        assert_eq!(recovery["errors"], serde_json::Value::Null, "{recovery}");
        assert_eq!(
            recovery["data"]["worktree_merge_recovery"]["operation_id"],
            operation_id.replace('-', "")
        );
        assert_eq!(
            recovery["data"]["worktree_merge_recovery"]["outcome"],
            "conflicted"
        );

        if finish {
            write(&repository.join("conflict.txt"), "resolved\n");
            git(&["add", "conflict.txt"], &repository);
            let finished = fixture.finish_merge(operation_id).await;
            assert_eq!(finished["errors"], serde_json::Value::Null, "{finished}");
            assert_eq!(
                finished["data"]["worktree_merge_finish"]["outcome"],
                "merged"
            );
        } else {
            let aborted = fixture.abort_merge(operation_id).await;
            assert_eq!(aborted["errors"], serde_json::Value::Null, "{aborted}");
            assert_eq!(
                aborted["data"]["worktree_merge_abort"]["outcome"],
                "aborted"
            );
        }
    }
}

#[tokio::test]
async fn finish_commits_only_the_already_staged_resolution() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    let preview = fixture.merge_preview(None).await;
    let operation_id = "90000000-0000-0000-0000-000000000012";
    let conflicted = fixture.merge(operation_id, &preview).await;
    assert_eq!(
        conflicted["data"]["worktree_merge"]["outcome"],
        "conflicted"
    );

    let refused = fixture.finish_merge(operation_id).await;
    assert_eq!(error_code(&refused), "worktree_merge_unresolved");

    write(&repository.join("conflict.txt"), "resolved\n");
    git(&["add", "conflict.txt"], &repository);
    write(&repository.join("not-staged.txt"), "leave me alone\n");
    let finished = fixture.finish_merge(operation_id).await;

    assert_eq!(finished["errors"], serde_json::Value::Null, "{finished}");
    assert_eq!(
        finished["data"]["worktree_merge_finish"]["outcome"],
        "merged"
    );
    assert_eq!(
        fixture.finish_merge(operation_id).await["data"]["worktree_merge_finish"]["outcome"],
        "merged"
    );
    assert_eq!(
        git(&["show", "--format=", "--name-only", "HEAD"], &repository),
        "conflict.txt"
    );
    assert_eq!(
        git(&["status", "--porcelain"], &repository),
        "?? not-staged.txt"
    );
    assert!(!PathBuf::from(git(&["rev-parse", "--git-path", "MERGE_HEAD"], &repository)).exists());

    assert_eq!(
        fixture.merge_recovery().await["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
    std::fs::remove_file(repository.join("not-staged.txt")).expect("remove untracked file");
    let next_preview = fixture.merge_preview(None).await;
    let next = fixture
        .merge("90000000-0000-0000-0000-000000000016", &next_preview)
        .await;
    assert_eq!(next["errors"], serde_json::Value::Null, "{next}");
}

#[tokio::test]
async fn abort_uses_git_merge_abort_and_preserves_untracked_work() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);
    let destination_before = git(&["rev-parse", "HEAD"], &repository);
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    let source_before = git(&["rev-parse", "HEAD"], &fixture.checkout);
    let preview = fixture.merge_preview(None).await;
    let operation_id = "90000000-0000-0000-0000-000000000013";
    let conflicted = fixture.merge(operation_id, &preview).await;
    assert_eq!(
        conflicted["data"]["worktree_merge"]["outcome"],
        "conflicted"
    );
    write(&repository.join("keep-untracked.txt"), "keep me\n");

    let aborted = fixture.abort_merge(operation_id).await;

    assert_eq!(aborted["errors"], serde_json::Value::Null, "{aborted}");
    assert_eq!(
        aborted["data"]["worktree_merge_abort"]["outcome"],
        "aborted"
    );
    assert_eq!(
        fixture.abort_merge(operation_id).await["data"]["worktree_merge_abort"]["outcome"],
        "aborted"
    );
    assert_eq!(git(&["rev-parse", "HEAD"], &repository), destination_before);
    assert_eq!(
        git(&["rev-parse", "HEAD"], &fixture.checkout),
        source_before
    );
    assert_eq!(
        git(&["status", "--porcelain"], &repository),
        "?? keep-untracked.txt"
    );
    assert!(!PathBuf::from(git(&["rev-parse", "--git-path", "MERGE_HEAD"], &repository)).exists());

    assert_eq!(
        fixture.merge_recovery().await["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
    std::fs::remove_file(repository.join("keep-untracked.txt")).expect("remove untracked file");
    let next = fixture
        .merge("90000000-0000-0000-0000-000000000017", &preview)
        .await;
    assert_eq!(next["errors"], serde_json::Value::Null, "{next}");
    assert_eq!(next["data"]["worktree_merge"]["outcome"], "conflicted");
}

#[tokio::test]
async fn recovery_read_reports_conflict_and_an_external_finish() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    let operation_id = "90000000-0000-0000-0000-000000000014";
    let preview = fixture.merge_preview(None).await;
    fixture.merge(operation_id, &preview).await;

    let conflict = fixture.merge_recovery().await;
    assert_eq!(conflict["errors"], serde_json::Value::Null, "{conflict}");
    assert_eq!(
        conflict["data"]["worktree_merge_recovery"]["operation_id"],
        operation_id.replace('-', "")
    );
    assert_eq!(
        conflict["data"]["worktree_merge_recovery"]["outcome"],
        "conflicted"
    );

    write(&repository.join("conflict.txt"), "resolved externally\n");
    git(&["add", "conflict.txt"], &repository);
    git(&["commit", "--no-edit"], &repository);
    let finished = fixture.merge_recovery().await;
    assert_eq!(finished["errors"], serde_json::Value::Null, "{finished}");
    assert_eq!(
        finished["data"]["worktree_merge_recovery"]["outcome"],
        "merged"
    );
    assert_eq!(
        fixture.merge_recovery().await["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn recovery_read_reports_an_external_abort() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    let operation_id = "90000000-0000-0000-0000-000000000015";
    let preview = fixture.merge_preview(None).await;
    fixture.merge(operation_id, &preview).await;
    git(&["merge", "--abort"], &repository);

    let aborted = fixture.merge_recovery().await;

    assert_eq!(aborted["errors"], serde_json::Value::Null, "{aborted}");
    assert_eq!(
        aborted["data"]["worktree_merge_recovery"]["outcome"],
        "aborted"
    );
    assert_eq!(
        fixture.merge_recovery().await["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn merge_reports_already_integrated_merges_divergence_and_blocks_stale_intent() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture._directory.path().join("repositories/ticketry");
    let preview = fixture.merge_preview(None).await;
    git(&["merge", "--ff-only", "wt/CODIN-881-task"], &repository);
    let integrated_preview = fixture.merge_preview(None).await;
    let integrated = fixture
        .merge("90000000-0000-0000-0000-000000000002", &integrated_preview)
        .await;
    assert_eq!(
        integrated["errors"],
        serde_json::Value::Null,
        "{integrated}"
    );
    assert_eq!(
        integrated["data"]["worktree_merge"]["outcome"],
        "already_integrated"
    );

    write(&repository.join("destination.txt"), "destination work\n");
    git(&["add", "."], &repository);
    git(&["commit", "-m", "destination work"], &repository);
    write(&fixture.checkout.join("source-again.txt"), "source work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "source again"], &fixture.checkout);
    let divergent_preview = fixture.merge_preview(None).await;
    assert_eq!(divergent_preview["ready"], true);
    let merged = fixture
        .merge("90000000-0000-0000-0000-000000000003", &divergent_preview)
        .await;
    assert_eq!(merged["errors"], serde_json::Value::Null, "{merged}");
    assert_eq!(merged["data"]["worktree_merge"]["outcome"], "merged");
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    let refs_after_merge = git(&["show-ref"], &repository);

    let stale = fixture
        .merge("90000000-0000-0000-0000-000000000004", &preview)
        .await;
    assert_eq!(error_code(&stale), "worktree_merge_preview_stale");
    assert_eq!(git(&["show-ref"], &repository), refs_after_merge);
}

#[tokio::test]
async fn merge_preserves_staged_unstaged_and_untracked_work_in_both_checkouts() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture._directory.path().join("repositories/ticketry");
    let preview = fixture.merge_preview(None).await;

    write(&fixture.checkout.join("README.md"), "staged source\n");
    git(&["add", "README.md"], &fixture.checkout);
    write(
        &fixture.checkout.join("src/unstaged.rs"),
        "unstaged source\n",
    );
    write(
        &fixture.checkout.join("source-untracked.txt"),
        "untracked source\n",
    );
    let source_before = git(
        &["status", "--porcelain=v1", "--untracked-files=all"],
        &fixture.checkout,
    );
    let source_blocked = fixture
        .merge("90000000-0000-0000-0000-000000000005", &preview)
        .await;
    assert_ne!(
        source_blocked["errors"],
        serde_json::Value::Null,
        "{source_blocked}"
    );
    assert_eq!(
        git(
            &["status", "--porcelain=v1", "--untracked-files=all"],
            &fixture.checkout
        ),
        source_before
    );
    assert_eq!(
        git(&["rev-parse", "HEAD"], &repository),
        preview["destination_commit"]
    );

    git(&["restore", "--staged", "README.md"], &fixture.checkout);
    git(
        &["restore", "README.md", "src/unstaged.rs"],
        &fixture.checkout,
    );
    std::fs::remove_file(fixture.checkout.join("source-untracked.txt"))
        .expect("clean source fixture");
    write(&repository.join("README.md"), "staged destination\n");
    git(&["add", "README.md"], &repository);
    write(
        &repository.join("src/unstaged.rs"),
        "unstaged destination\n",
    );
    write(
        &repository.join("destination-untracked.txt"),
        "untracked destination\n",
    );
    let destination_before = git(
        &["status", "--porcelain=v1", "--untracked-files=all"],
        &repository,
    );
    let destination_blocked = fixture
        .merge("90000000-0000-0000-0000-000000000006", &preview)
        .await;
    assert_ne!(
        destination_blocked["errors"],
        serde_json::Value::Null,
        "{destination_blocked}"
    );
    assert_eq!(
        git(
            &["status", "--porcelain=v1", "--untracked-files=all"],
            &repository
        ),
        destination_before
    );
    assert_eq!(
        git(&["rev-parse", "wt/CODIN-881-task"], &repository),
        preview["source_commit"]
    );
}

#[tokio::test]
async fn recorded_origin_autopopulates_without_a_creation_journal() {
    let fixture = fixture().await;
    fixture.execute("DELETE FROM workspace_operations").await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    let origin = fixture._directory.path().join("checkouts/origin");
    git(
        &[
            "worktree",
            "add",
            "-b",
            "release/origin",
            &origin.display().to_string(),
            "main",
        ],
        &repository,
    );
    fixture
        .execute("UPDATE worktrees SET base_branch = 'release/origin'")
        .await;

    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["destination_branch"], "release/origin");
    assert_eq!(
        preview["destination_checkout"],
        origin.canonicalize().unwrap().display().to_string()
    );
    assert_eq!(preview["ready"], true);
    assert_eq!(preview["requires_destination_selection"], false);

    write(&fixture.checkout.join("uncommitted.txt"), "source dirt\n");
    let dirty = fixture.merge_preview(None).await;
    assert_eq!(dirty["blocker"], "source_dirty");
    assert_eq!(dirty["destination_branch"], "release/origin");
    assert_eq!(
        dirty["destination_checkout"],
        preview["destination_checkout"]
    );
}

#[tokio::test]
async fn an_invalid_recorded_origin_does_not_offer_a_merge() {
    let fixture = fixture().await;
    fixture.execute("DELETE FROM workspace_operations").await;
    fixture
        .execute("UPDATE worktrees SET base_commit = '0000000000000000000000000000000000000000'")
        .await;
    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["destination_branch"], "main");
    assert_eq!(preview["ready"], false);
    assert_eq!(preview["requires_destination_selection"], false);
    assert_eq!(preview["blocker"], "destination_selection_required");
}

#[tokio::test]
async fn preview_keeps_a_selected_non_main_destination_and_explains_blockers() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    let release = fixture._directory.path().join("checkouts/release");
    git(
        &[
            "worktree",
            "add",
            "-b",
            "release/next",
            &release.display().to_string(),
            "main",
        ],
        &repository,
    );

    let selected = fixture.merge_preview(Some("release/next")).await;
    assert_eq!(selected["destination_branch"], "release/next");
    assert_eq!(
        selected["destination_checkout"],
        release.canonicalize().unwrap().display().to_string()
    );
    assert_eq!(selected["ready"], true);

    write(&release.join("dirty.txt"), "not committed\n");
    let dirty = fixture.merge_preview(Some("release/next")).await;
    assert_eq!(dirty["blocker"], "destination_dirty");
    assert!(dirty["reason"].as_str().unwrap().contains("clean"));

    let self_destination = fixture.merge_preview(Some("wt/CODIN-881-task")).await;
    assert_eq!(self_destination["blocker"], "self_destination");

    let invalid = fixture.merge_preview(Some("-invalid")).await;
    assert_eq!(invalid["blocker"], "destination_invalid");

    let missing = fixture.merge_preview(Some("release/missing")).await;
    assert_eq!(missing["blocker"], "destination_missing");
}

#[tokio::test]
async fn preview_requires_clean_checkouts_and_an_existing_destination_checkout() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    git(&["branch", "release/not-checked-out"], &repository);

    let unchecked = fixture.merge_preview(Some("release/not-checked-out")).await;
    assert_eq!(unchecked["blocker"], "destination_checkout_missing");
    let choice = unchecked["destinations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|choice| choice["branch"] == "release/not-checked-out")
        .expect("unchecked local branch remains selectable");
    assert_eq!(choice["checkout"], serde_json::Value::Null);
    assert!(unchecked["reason"].as_str().unwrap().contains("Check out"));

    write(&fixture.checkout.join("uncommitted.txt"), "source dirt\n");
    let dirty = fixture.merge_preview(None).await;
    assert_eq!(dirty["blocker"], "source_dirty");

    std::fs::remove_file(fixture.checkout.join("uncommitted.txt")).expect("clean source");
    let merge_head = git(
        &["rev-parse", "--git-path", "MERGE_HEAD"],
        &fixture.checkout,
    );
    write(
        Path::new(&merge_head),
        &format!("{}\n", git(&["rev-parse", "HEAD"], &fixture.checkout)),
    );
    let merging = fixture.merge_preview(None).await;
    assert_eq!(merging["blocker"], "source_operation_in_progress");

    std::fs::remove_file(&merge_head).expect("clear merge state");
    let rebase = PathBuf::from(git(
        &["rev-parse", "--git-path", "rebase-merge"],
        &fixture.checkout,
    ));
    let rebase = if rebase.is_absolute() {
        rebase
    } else {
        fixture.checkout.join(rebase)
    };
    std::fs::create_dir_all(rebase).expect("create paused rebase state");
    let rebasing = fixture.merge_preview(None).await;
    assert_eq!(rebasing["blocker"], "source_operation_in_progress");
}

#[tokio::test]
async fn preview_reports_a_merge_conflict_without_starting_a_merge() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    write(&fixture.checkout.join("conflict.txt"), "source side\n");
    git(&["commit", "-am", "source side"], &fixture.checkout);
    write(&repository.join("conflict.txt"), "destination side\n");
    git(&["commit", "-am", "destination side"], &repository);

    let preview = fixture.merge_preview(None).await;

    assert_eq!(preview["ready"], true);
    assert_eq!(preview["blocker"], serde_json::Value::Null);
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    let merge_head = PathBuf::from(git(&["rev-parse", "--git-path", "MERGE_HEAD"], &repository));
    let merge_head = if merge_head.is_absolute() {
        merge_head
    } else {
        repository.join(merge_head)
    };
    assert!(!merge_head.exists());
}

fn error_code(response: &serde_json::Value) -> &str {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .expect("structured GraphQL error code")
}

async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create changes fixture directory");
    let state = directory.path().join("state.db");
    let repository_root = directory.path().join("repositories/ticketry");
    let checkout = directory.path().join("checkouts/CODIN-881-task");
    let base_commit = repository(&repository_root);
    git(
        &[
            "worktree",
            "add",
            "-b",
            "wt/CODIN-881-task",
            &checkout.display().to_string(),
            &base_commit,
        ],
        &repository_root,
    );

    let writer = Database::connect(format!("sqlite:{}?mode=rwc", state.display()))
        .await
        .expect("open the fixture writer");
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                onboarding_required bool NOT NULL
            );
            CREATE TABLE worktracker_state (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, "group" varchar(32) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                is_protected bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, level varchar(16) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                start_state_id char(32), workflow_revision integer NOT NULL,
                is_pathfind bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order text NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id)
            );
            CREATE TABLE worktrees (
                id VARCHAR NOT NULL PRIMARY KEY, task_id VARCHAR NOT NULL UNIQUE,
                workspace_slug VARCHAR, project_id VARCHAR, module_id VARCHAR,
                ticket_seq INTEGER, repo_root VARCHAR NOT NULL, path VARCHAR NOT NULL,
                branch VARCHAR NOT NULL, base_branch VARCHAR NOT NULL,
                base_commit VARCHAR NOT NULL, status VARCHAR NOT NULL,
                ephemeral BOOLEAN NOT NULL, created_at VARCHAR NOT NULL,
                updated_at VARCHAR NOT NULL
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Coding', 'CODIN', '', 900, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{TASK_TYPE}', '{PROJECT}', 'Story', 'task', '', 0, '{BACKLOG}', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{MODULE_TYPE}', '{PROJECT}', 'Module', 'module', '', 1, NULL, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Ticketry', 880, 0, 'y', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Task', 881, 0, 'z', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktrees VALUES (
                '70000000000000000000000000000001', '{TASK}', 'meml', '{PROJECT}',
                '{MODULE}', 881, '{repository}', '{checkout}', 'wt/CODIN-881-task',
                'main', '{base_commit}', 'active', 0,
                '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00'
            );
            "#,
            repository = repository_root.display(),
            checkout = checkout.display(),
        ))
        .await
        .expect("create worktree changes fixture");
    link_module(&writer, &repository_root).await;
    drop(writer);

    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state,
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("compose the worktree changes schema");

    let writer = Database::connect(format!("sqlite:{}?mode=rw", state.display()))
        .await
        .expect("reopen fixture writer");
    let intent = serde_json::json!({
        "kind": "worktree_create",
        "intentVersion": 2,
        "payload": {
            "taskId": TASK,
            "branch": "wt/CODIN-881-task",
            "checkoutName": "CODIN-881-task",
            "repositoryDigest": "a".repeat(64),
            "baseRef": "main",
            "baseCommit": base_commit.clone(),
        }
    })
    .to_string();
    let evidence = serde_json::json!({
        "worktreeId": "70000000000000000000000000000001",
        "adopted": false,
        "branch": "wt/CODIN-881-task",
        "baseRef": "main",
        "baseCommit": base_commit.clone(),
        "checkoutName": "CODIN-881-task",
    })
    .to_string();
    let result = serde_json::json!({
        "worktreeId": "70000000000000000000000000000001",
        "taskId": TASK,
        "branch": "wt/CODIN-881-task",
        "checkoutName": "CODIN-881-task",
        "baseRef": "main",
        "baseCommit": base_commit.clone(),
        "adopted": false,
    })
    .to_string();
    writer
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO workspace_operations
             (operation_id, kind, intent_version, resource_kind, resource_key, intent,
              intent_fingerprint, state, attempt_count, evidence, result_summary,
              created_at, updated_at, settled_at)
             VALUES (?, 'worktree_create', 2, 'worktree', ?, ?, ?, 'applied', 1, ?, ?,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [
                "80000000000000000000000000000001".into(),
                format!("worktree/{TASK}").into(),
                intent.into(),
                "b".repeat(64).into(),
                evidence.into(),
                result.into(),
            ],
        ))
        .await
        .expect("record durable creation provenance");
    drop(writer);

    Fixture {
        _directory: directory,
        api,
        checkout,
        base_commit,
    }
}

#[tokio::test]
async fn committed_task_changes_remain_visible_in_a_clean_checkout() {
    let fixture = fixture().await;
    write(
        &fixture.checkout.join("src/committed.rs"),
        "pub fn task_work() {}\n",
    );
    git(&["add", "."], &fixture.checkout);
    let before = fixture.status_and_changes(TASK).await;
    assert_eq!(before["errors"], serde_json::Value::Null, "{before}");
    assert_eq!(before["data"]["worktree_status"]["dirty"], true);

    git(&["commit", "-m", "task work"], &fixture.checkout);

    let after = fixture.status_and_changes(TASK).await;
    assert_eq!(after["errors"], serde_json::Value::Null, "{after}");
    assert_eq!(after["data"]["worktree_status"]["dirty"], false);
    assert_eq!(
        after["data"]["worktree_changes"]["files"],
        before["data"]["worktree_changes"]["files"]
    );
    let changes = fixture.changes(TASK).await;

    assert_eq!(changes["base_commit"], fixture.base_commit);
    assert_eq!(changes["truncated"], false);
    assert_eq!(
        changes["files"],
        serde_json::json!([{
            "path": "src/committed.rs",
            "previous_path": null,
            "status": "added",
            "binary": false,
            "insertions": 1,
            "deletions": 0
        }])
    );
}

#[tokio::test]
async fn recorded_base_remains_stable_when_the_base_branch_advances() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task-only.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let before = fixture.changes(TASK).await;

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("base-advanced.txt"), "new base work\n");
    git(&["add", "."], &primary);
    git(&["commit", "-m", "advance base branch"], &primary);

    let after = fixture.changes(TASK).await;
    assert_eq!(after["base_commit"], fixture.base_commit);
    assert_eq!(after["files"], before["files"]);
    assert_eq!(after["files"].as_array().unwrap().len(), 1);
    assert_eq!(after["files"][0]["path"], "task-only.txt");
}

#[tokio::test]
async fn committed_index_worktree_untracked_and_conflicted_paths_form_one_net_list() {
    let fixture = fixture().await;

    write(&fixture.checkout.join("src/committed.rs"), "committed\n");
    write(&fixture.checkout.join("conflict.txt"), "task side\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "committed task work"], &fixture.checkout);

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("conflict.txt"), "base side\n");
    git(&["commit", "-am", "base conflict"], &primary);
    let merge = Command::new("git")
        .arg("-C")
        .arg(&fixture.checkout)
        .args(["merge", "--no-edit", "main"])
        .output()
        .expect("attempt conflicting merge");
    assert!(!merge.status.success(), "the fixture merge must conflict");

    write(&fixture.checkout.join("src/staged.rs"), "staged\n");
    git(&["add", "src/staged.rs"], &fixture.checkout);
    write(
        &fixture.checkout.join("src/unstaged.rs"),
        "pub fn after() {}\n",
    );
    write(&fixture.checkout.join("src/untracked.rs"), "untracked\n");
    std::fs::remove_file(fixture.checkout.join("deleted.txt")).expect("delete tracked file");
    git(
        &["mv", "rename-old.txt", "rename-new.txt"],
        &fixture.checkout,
    );
    std::fs::copy(
        fixture.checkout.join("copy-source.txt"),
        fixture.checkout.join("copy-target.txt"),
    )
    .expect("copy tracked content");
    git(&["add", "copy-target.txt"], &fixture.checkout);

    let changes = fixture.changes(TASK).await;

    assert_eq!(
        changes["files"],
        serde_json::json!([
            {"path": "conflict.txt", "previous_path": null, "status": "conflicted", "binary": false, "insertions": 5, "deletions": 1},
            {"path": "copy-target.txt", "previous_path": "copy-source.txt", "status": "copied", "binary": false, "insertions": 0, "deletions": 0},
            {"path": "deleted.txt", "previous_path": null, "status": "deleted", "binary": false, "insertions": 0, "deletions": 1},
            {"path": "rename-new.txt", "previous_path": "rename-old.txt", "status": "renamed", "binary": false, "insertions": 0, "deletions": 0},
            {"path": "src/committed.rs", "previous_path": null, "status": "added", "binary": false, "insertions": 1, "deletions": 0},
            {"path": "src/staged.rs", "previous_path": null, "status": "added", "binary": false, "insertions": 1, "deletions": 0},
            {"path": "src/unstaged.rs", "previous_path": null, "status": "modified", "binary": false, "insertions": 1, "deletions": 1},
            {"path": "src/untracked.rs", "previous_path": null, "status": "untracked", "binary": false, "insertions": 1, "deletions": 0}
        ])
    );
}

#[tokio::test]
async fn a_child_identity_resolves_the_top_level_task_worktree() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("child.txt"), "shared checkout\n");

    let changes = fixture.changes(CHILD_TASK).await;

    assert_eq!(changes["task_id"], "60000000-0000-0000-0000-000000000002");
    assert_eq!(
        changes["top_level_task_id"],
        "60000000-0000-0000-0000-000000000001"
    );
    assert_eq!(changes["is_shared"], true);
    assert_eq!(changes["files"][0]["path"], "child.txt");
}

#[tokio::test]
async fn changed_file_output_is_sorted_bounded_and_explicitly_truncated() {
    let fixture = fixture().await;
    for index in (0..520).rev() {
        write(
            &fixture.checkout.join(format!("bulk/{index:03}.txt")),
            "untracked\n",
        );
    }

    let changes = fixture.changes(TASK).await;
    let files = changes["files"].as_array().expect("changed files");

    assert_eq!(changes["truncated"], true);
    assert_eq!(files.len(), 500);
    assert_eq!(files.first().unwrap()["path"], "bulk/000.txt");
    assert_eq!(files.last().unwrap()["path"], "bulk/499.txt");
}

#[tokio::test]
async fn a_git_byte_limit_never_returns_a_partial_nul_delimited_path() {
    let fixture = fixture().await;
    for index in 0..400 {
        write(
            &fixture
                .checkout
                .join(format!("long/{index:03}-{}.txt", "x".repeat(170))),
            "untracked\n",
        );
    }

    let changes = fixture.changes(TASK).await;
    let files = changes["files"].as_array().expect("changed files");

    assert_eq!(changes["truncated"], true);
    assert!(files.len() < 400, "the Git byte bound must be observable");
    for file in files {
        let path = file["path"].as_str().expect("complete UTF-8 path");
        assert!(
            fixture.checkout.join(path).is_file(),
            "partial path: {path}"
        );
    }
}

#[tokio::test]
async fn a_conflict_after_truncated_porcelain_keeps_its_exact_base_status() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("conflict.txt"), "task side\n");
    git(&["add", "conflict.txt"], &fixture.checkout);
    git(&["commit", "-m", "task side"], &fixture.checkout);

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("conflict.txt"), "base side\n");
    git(&["commit", "-am", "base side"], &primary);
    let merge = Command::new("git")
        .arg("-C")
        .arg(&fixture.checkout)
        .args(["merge", "--no-edit", "main"])
        .output()
        .expect("attempt conflicting merge");
    assert!(!merge.status.success(), "the fixture merge must conflict");

    for index in 0..400 {
        write(
            &fixture
                .checkout
                .join(format!("a-cancel/{index:03}-{}.txt", "x".repeat(170))),
            "cancelled add\n",
        );
    }
    git(&["add", "a-cancel"], &fixture.checkout);
    std::fs::remove_dir_all(fixture.checkout.join("a-cancel")).expect("cancel added fixture paths");

    let changes = fixture.changes(TASK).await;
    assert_eq!(changes["truncated"], true);
    let conflict = changes["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "conflict.txt")
        .expect("conflict remains in the bounded list");
    assert_eq!(conflict["status"], "conflicted");
}

#[tokio::test]
async fn missing_index_repository_checkout_and_base_have_distinct_error_codes() {
    let no_index = fixture().await;
    no_index.execute("DELETE FROM worktrees").await;
    assert_eq!(
        error_code(&no_index.response(TASK).await),
        "worktree_changes_not_found"
    );

    let missing_repository = fixture().await;
    std::fs::remove_dir_all(
        missing_repository
            ._directory
            .path()
            .join("repositories/ticketry"),
    )
    .expect("remove repository");
    assert_eq!(
        error_code(&missing_repository.response(TASK).await),
        "worktree_changes_repository_missing"
    );

    let missing_checkout = fixture().await;
    std::fs::remove_dir_all(&missing_checkout.checkout).expect("remove checkout");
    assert_eq!(
        error_code(&missing_checkout.response(TASK).await),
        "worktree_changes_checkout_missing"
    );

    let missing_base = fixture().await;
    missing_base
        .execute("UPDATE worktrees SET base_commit = '0000000000000000000000000000000000000000'")
        .await;
    assert_eq!(
        error_code(&missing_base.response(TASK).await),
        "worktree_changes_git_unavailable"
    );
}

#[tokio::test]
async fn an_invalid_recorded_path_is_a_typed_failure() {
    let recorded = fixture().await;
    recorded
        .execute("UPDATE worktrees SET path = '../outside'")
        .await;
    assert_eq!(
        error_code(&recorded.response(TASK).await),
        "worktree_changes_invalid_path"
    );
}

#[tokio::test]
async fn an_absolute_checkout_from_another_repository_is_rejected() {
    let fixture = fixture().await;
    let outside = fixture._directory.path().join("outside-repository");
    repository(&outside);
    fixture
        .execute(&format!(
            "UPDATE worktrees SET path = '{}'",
            outside.display()
        ))
        .await;

    assert_eq!(
        error_code(&fixture.response(TASK).await),
        "worktree_changes_invalid_path"
    );
}

#[tokio::test]
async fn owner_and_storage_failures_keep_their_structured_codes() {
    let fixture = fixture().await;
    assert_eq!(
        error_code(
            &fixture
                .response("60000000-0000-0000-0000-00000000dead")
                .await
        ),
        "worktree_work_item_not_found"
    );

    fixture.execute("DROP TABLE worktrees").await;
    assert_eq!(
        error_code(&fixture.response(TASK).await),
        "worktree_changes_storage_failed"
    );
}

#[tokio::test]
async fn module_list_is_read_only_current_and_ordered_from_the_checkout() {
    let fixture = fixture().await;
    let primary = fixture._directory.path().join("repositories/ticketry");
    let head_before = git(&["rev-parse", "HEAD"], &primary);
    let status_before = git(&["status", "--porcelain"], &primary);

    let response = fixture.module_version_control().await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    let view = &response["data"]["module_version_control"];
    assert_eq!(view["module_id"], MODULE_PUBLIC);
    assert_eq!(view["checkout"]["available"], true);
    assert_eq!(view["checkout"]["clean"], true);
    assert_eq!(view["worktrees"][0]["kind"], "module");
    assert_eq!(view["worktrees"][1]["kind"], "task");
    assert_eq!(view["worktrees"][1]["task_key"], "CODIN-881");
    assert_eq!(view["worktrees"][1]["task_name"], "Task");
    assert_eq!(view["worktrees"][1]["pull_request_state"], "none");
    assert_eq!(view["worktrees_truncated"], false);

    assert_eq!(git(&["rev-parse", "HEAD"], &primary), head_before);
    assert_eq!(git(&["status", "--porcelain"], &primary), status_before);
    let repeated = fixture.module_version_control().await;
    assert_eq!(repeated["data"]["module_version_control"], *view);

    fixture
        .execute("UPDATE worktrees SET status = 'integrated'")
        .await;
    let integrated = fixture.module_version_control().await;
    assert_eq!(
        integrated["data"]["module_version_control"]["worktrees"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fixture
        .execute("UPDATE worktrees SET status = 'discarded'")
        .await;
    let discarded = fixture.module_version_control().await;
    assert_eq!(
        discarded["data"]["module_version_control"]["worktrees"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn generated_worktree_list_and_module_files_load_independently() {
    let fixture = fixture().await;
    let primary = fixture._directory.path().join("repositories/ticketry");
    let moved = fixture._directory.path().join("offline-repository");
    std::fs::rename(&primary, &moved).unwrap();
    let response = fixture.api.clone().graphql_execute(serde_json::json!({
        "query": include_str!("../../src/features/agents/worktrees/operations/currentWorktrees.graphql"),
        "variables": { "moduleId": MODULE },
    }).to_string()).await;
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    let nodes = response["data"]["worktrees"]["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0]["issue"]["name"], "Task");
    assert_eq!(nodes[0]["project"]["slug"], "CODIN");
    std::fs::rename(&moved, &primary).unwrap();

    fixture.execute("DROP TABLE worktrees").await;
    let response = fixture.api.clone().graphql_execute(serde_json::json!({
        "query": include_str!("../../src/features/agents/worktrees/operations/moduleVersionControl.graphql"),
        "variables": { "moduleId": MODULE_PUBLIC },
    }).to_string()).await;
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    assert_eq!(
        response["data"]["module_version_control"]["checkout"]["available"],
        true
    );
}
