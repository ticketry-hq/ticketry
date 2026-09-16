//! A provider wait must not freeze local reads or make cleanup use old Git facts.
#[path = "common/worktree_completion_git.rs"]
mod git_fixture;
#[path = "common/worktree_completion_support.rs"]
mod support;

use git_fixture::Scenario;
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

const TASK: &str = "60000000000000000000000000000001";
const QUERY: &str = r#"query($taskId: String!) {
    worktree_changes(task_id: $taskId) {
        clean dirty files { path status } cleanup { eligible blocker }
    }
}"#;

struct PendingGithub {
    directory: tempfile::TempDir,
    previous: Option<std::ffi::OsString>,
}

impl PendingGithub {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let program = directory.path().join("gh");
        std::fs::write(&program, r#"#!/bin/sh
fixture=$(dirname "$0")
touch "$fixture/started"
while [ ! -f "$fixture/release" ]; do sleep 0.01; done
printf '{"state":"MERGED","baseRefName":"main","headRefOid":"%s","mergeable":"MERGEABLE","reviewDecision":null}' "$(git rev-parse HEAD)"
"#).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let previous = std::env::var_os("MUXED_APPROVED_GH_PATH");
        std::env::set_var("MUXED_APPROVED_GH_PATH", program);
        Self {
            directory,
            previous,
        }
    }

    async fn wait_started(&self) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while !self.directory.path().join("started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("changes query reached provider");
    }

    fn release(&self) {
        std::fs::write(self.directory.path().join("release"), "").unwrap();
    }
}

impl Drop for PendingGithub {
    fn drop(&mut self) {
        self.release();
        match &self.previous {
            Some(value) => std::env::set_var("MUXED_APPROVED_GH_PATH", value),
            None => std::env::remove_var("MUXED_APPROVED_GH_PATH"),
        }
    }
}

#[tokio::test]
async fn edits_during_a_provider_wait_are_visible_and_block_cleanup() {
    let task = support::fixture(Scenario::Clean).await;
    task.complete().await;
    task.map_pull_request().await;
    let github = PendingGithub::new();
    let query = task.graphql(QUERY, serde_json::json!({"taskId": TASK}));
    let edit = async {
        github.wait_started().await;
        // This uses the same repository lock as the suspended changes query.
        let status = tokio::time::timeout(Duration::from_secs(3), task.status()).await;
        // Release the child process even if the lock assertion fails.
        if status.is_err() {
            github.release();
        }
        assert_eq!(
            status.expect("local status proceeds during provider wait")["dirty"],
            false
        );
        std::fs::write(
            task.checkout_path().join("README.md"),
            "new uncommitted work\n",
        )
        .unwrap();
        let staged = std::process::Command::new("git")
            .arg("-C")
            .arg(task.checkout_path())
            .args(["add", "README.md"])
            .status()
            .unwrap();
        assert!(staged.success());
        github.release();
    };
    let (response, ()) = tokio::join!(query, edit);
    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    let changes = &response["data"]["worktree_changes"];
    assert_eq!(changes["dirty"], true);
    assert_eq!(changes["clean"], false);
    assert_eq!(changes["cleanup"]["eligible"], false);
    assert_eq!(changes["cleanup"]["blocker"], "checkout_dirty");
    assert!(changes["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "README.md"));
}
