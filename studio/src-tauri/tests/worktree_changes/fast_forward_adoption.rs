use super::*;

use sha2::{Digest, Sha256};
use ticketry_workspace_runtime::workspace_operations::{
    WorkspaceOperationIntent, WorkspaceOperationJournal, WorkspaceOperationKind,
};

#[tokio::test]
async fn fast_forward_retry_succeeds_after_destination_advances_without_git_writes() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture._directory.path().join("repositories/ticketry");
    let preview = fixture.merge_preview(None).await;
    let operation_id = "90000000-0000-0000-0000-000000000038";
    let first = fixture.merge(operation_id, &preview).await;
    assert_eq!(first["errors"], serde_json::Value::Null, "{first}");
    assert_eq!(first["data"]["worktree_merge"]["outcome"], "fast_forwarded");

    git(
        &["commit", "--allow-empty", "-m", "later destination work"],
        &repository,
    );
    let head = git(&["rev-parse", "HEAD"], &repository);
    let refs = git(&["show-ref"], &repository);
    let reflog = git(&["reflog", "show", "--all"], &repository);

    let repeated = fixture.merge(operation_id, &preview).await;
    assert_eq!(repeated["errors"], serde_json::Value::Null, "{repeated}");
    assert_eq!(
        repeated["data"]["worktree_merge"]["outcome"],
        "fast_forwarded"
    );
    assert_eq!(
        repeated["data"]["worktree_merge"]["destination_commit"],
        head
    );
    let recovery = fixture.merge_recovery().await;
    assert_eq!(recovery["errors"], serde_json::Value::Null, "{recovery}");
    assert_eq!(
        recovery["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
    assert_eq!(git(&["show-ref"], &repository), refs);
    assert_eq!(git(&["reflog", "show", "--all"], &repository), reflog);
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    assert_eq!(git(&["status", "--porcelain"], &fixture.checkout), "");
}

#[tokio::test]
async fn restart_adopts_unsettled_fast_forward_after_destination_advances_without_git_writes() {
    let mut fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let repository = fixture
        ._directory
        .path()
        .join("repositories/ticketry")
        .canonicalize()
        .expect("canonical repository");
    let preview = fixture.merge_preview(None).await;
    let operation_id = "90000000-0000-0000-0000-000000000039";
    let journal = WorkspaceOperationJournal::new(
        Database::connect(format!(
            "sqlite:{}?mode=rw",
            fixture._directory.path().join("state.db").display()
        ))
        .await
        .expect("open journal database"),
    );
    let checkout_digest = format!(
        "{:x}",
        Sha256::digest(repository.display().to_string().as_bytes())
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
                "repositoryDigest": checkout_digest,
                "sourceBranch": preview["source_branch"],
                "sourceCommit": preview["source_commit"],
                "destinationBranch": preview["destination_branch"],
                "destinationCommit": preview["destination_commit"],
                "destinationCheckoutIdentity": checkout_digest,
                "action": "fast_forward",
            }),
        })
        .await
        .expect("prepare confirmed fast-forward");
    journal
        .claim(operation_id, "interrupted-worker", 120)
        .await
        .expect("claim merge");
    git(
        &[
            "merge",
            "--ff-only",
            preview["source_commit"].as_str().unwrap(),
        ],
        &repository,
    );
    // Recreate a process stopping after Git applied, before journal settlement.
    fixture.execute(&format!(
        "UPDATE workspace_operations SET lease_expires_at='2000-01-01 00:00:00' WHERE operation_id='{}'",
        operation_id.replace('-', "")
    )).await;
    git(
        &["commit", "--allow-empty", "-m", "later destination work"],
        &repository,
    );
    let head = git(&["rev-parse", "HEAD"], &repository);
    let refs = git(&["show-ref"], &repository);
    let reflog = git(&["reflog", "show", "--all"], &repository);

    let restarted = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &fixture._directory.path().join("rust-core.sqlite3"),
        &fixture._directory.path().join("state.db"),
        &fixture._directory.path().join("media"),
        &restarted,
    )
    .await
    .expect("restart and reconcile the unfinished merge");
    fixture.api = restarted;

    let operation = journal.find(operation_id).await.unwrap().unwrap();
    assert_eq!(operation.state, "applied", "{operation:?}");
    assert_eq!(
        operation.result(),
        Some(serde_json::json!({"adopted": true}))
    );
    let retry = fixture.merge(operation_id, &preview).await;
    assert_eq!(retry["errors"], serde_json::Value::Null, "{retry}");
    assert_eq!(retry["data"]["worktree_merge"]["outcome"], "fast_forwarded");
    assert_eq!(retry["data"]["worktree_merge"]["destination_commit"], head);
    let recovery = fixture.merge_recovery().await;
    assert_eq!(recovery["errors"], serde_json::Value::Null, "{recovery}");
    assert_eq!(
        recovery["data"]["worktree_merge_recovery"],
        serde_json::Value::Null
    );
    assert_eq!(git(&["show-ref"], &repository), refs);
    assert_eq!(git(&["reflog", "show", "--all"], &repository), reflog);
    assert_eq!(git(&["status", "--porcelain"], &repository), "");
    assert_eq!(git(&["status", "--porcelain"], &fixture.checkout), "");
}
