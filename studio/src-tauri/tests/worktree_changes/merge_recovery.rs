use super::*;

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
