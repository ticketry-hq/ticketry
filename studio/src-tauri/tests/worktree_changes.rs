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

#[path = "worktree_changes/merge_blocked_recovery.rs"]
mod merge_blocked_recovery;

#[path = "worktree_changes/source_merge_recovery.rs"]
mod source_merge_recovery;

#[path = "worktree_changes/merge_execution.rs"]
mod merge_execution;

#[path = "worktree_changes/fast_forward_adoption.rs"]
mod fast_forward_adoption;

#[path = "worktree_changes/merge_recovery.rs"]
mod merge_recovery;

#[path = "worktree_changes/merge_preview.rs"]
mod merge_preview;

#[path = "worktree_changes/change_queries.rs"]
mod change_queries;

#[path = "worktree_changes/fixture_setup.rs"]
mod fixture_setup;

use fixture_setup::fixture;

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

fn error_code(response: &serde_json::Value) -> &str {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .expect("structured GraphQL error code")
}
