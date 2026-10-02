use super::*;

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
