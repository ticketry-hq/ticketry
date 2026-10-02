use super::*;

use sha2::{Digest, Sha256};
use ticketry_workspace_runtime::workspace_operations::{
    WorkspaceOperationIntent, WorkspaceOperationJournal, WorkspaceOperationKind,
};

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[tokio::test]
async fn restart_settles_dirty_source_as_a_blocker_for_each_merge_action() {
    for (operation_id, divergent) in [
        ("90000000-0000-0000-0000-000000000024", false),
        ("90000000-0000-0000-0000-000000000025", true),
    ] {
        let mut fixture = fixture().await;
        let repository = fixture._directory.path().join("repositories/ticketry");
        if divergent {
            write(&repository.join("destination.txt"), "destination work\n");
            git(&["add", "."], &repository);
            git(&["commit", "-m", "destination work"], &repository);
        }
        write(&fixture.checkout.join("source.txt"), "source work\n");
        git(&["add", "."], &fixture.checkout);
        git(&["commit", "-m", "source work"], &fixture.checkout);
        let preview = fixture.merge_preview(None).await;
        assert_eq!(preview["ready"], true, "{preview}");
        let source_head = git(&["rev-parse", "HEAD"], &fixture.checkout);
        let destination_head = git(&["rev-parse", "HEAD"], &repository);
        let repository = repository.canonicalize().expect("canonical repository");
        let checkout = repository.clone();
        let journal = WorkspaceOperationJournal::new(
            Database::connect(format!(
                "sqlite:{}?mode=rw",
                fixture._directory.path().join("state.db").display()
            ))
            .await
            .expect("open journal database"),
        );
        journal
            .prepare(WorkspaceOperationIntent {
                operation_id: operation_id.to_owned(),
                kind: WorkspaceOperationKind::WorktreeMerge,
                intent_version: 1,
                resource_key: format!("worktree/{TASK}"),
                payload: serde_json::json!({
                    "worktreeId": "70000000000000000000000000000001",
                    "taskId": TASK,
                    "repositoryDigest": digest(&repository.display().to_string()),
                    "sourceBranch": "wt/CODIN-881-task",
                    "sourceCommit": source_head,
                    "destinationBranch": "main",
                    "destinationCommit": destination_head,
                    "destinationCheckoutIdentity": digest(&checkout.display().to_string()),
                    "action": if divergent { "merge" } else { "fast_forward" },
                }),
            })
            .await
            .expect("prepare the confirmed merge before Git runs");

        write(
            &fixture.checkout.join("untracked-after-preview.txt"),
            "new source work\n",
        );
        let restarted = TransportApiImpl::new();
        initialize_with_worktracker_commands_and_install(
            &fixture._directory.path().join("rust-core.sqlite3"),
            &fixture._directory.path().join("state.db"),
            &fixture._directory.path().join("media"),
            &restarted,
        )
        .await
        .expect("restart and reconcile the prepared merge");
        fixture.api = restarted;

        let row = journal
            .find(operation_id)
            .await
            .expect("read merge journal")
            .expect("prepared merge row");
        assert_eq!(row.state, "failed", "{row:?}");
        assert_eq!(row.last_error_code.as_deref(), Some("worktree_merge_dirty"));

        let retry = fixture.merge(operation_id, &preview).await;
        assert_eq!(error_code(&retry), "worktree_merge_dirty", "{retry}");
        let recovery = fixture.merge_recovery().await;
        assert_eq!(recovery["errors"], serde_json::Value::Null, "{recovery}");
        assert_eq!(
            recovery["data"]["worktree_merge_recovery"],
            serde_json::Value::Null,
            "{recovery}"
        );
        assert!(!recovery.to_string().contains("aborted"));
        assert_eq!(git(&["rev-parse", "HEAD"], &repository), destination_head);
        assert_eq!(git(&["rev-parse", "HEAD"], &fixture.checkout), source_head);
        assert!(fixture
            .checkout
            .join("untracked-after-preview.txt")
            .exists());
    }
}
