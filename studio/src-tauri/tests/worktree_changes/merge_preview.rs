use super::*;

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
    assert_eq!(preview["destination_branch"], serde_json::Value::Null);
    assert_eq!(preview["destination_checkout"], serde_json::Value::Null);
    assert_eq!(preview["ready"], false);
    assert_eq!(preview["requires_destination_selection"], true);
    assert_eq!(preview["blocker"], "destination_selection_required");
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("Choose a local branch"));

    let selected = fixture.merge_preview(Some("main")).await;
    assert_eq!(selected["destination_branch"], "main");
    assert_eq!(selected["ready"], true);
    assert_eq!(selected["requires_destination_selection"], false);
}

#[tokio::test]
async fn a_detached_creation_origin_requires_a_local_destination_choice() {
    let fixture = fixture().await;
    fixture
        .execute("UPDATE worktrees SET base_branch = base_commit")
        .await;

    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["blocker"], "destination_selection_required");
    assert_eq!(preview["destination_branch"], serde_json::Value::Null);
    assert_eq!(preview["destination_checkout"], serde_json::Value::Null);
    assert_eq!(preview["requires_destination_selection"], true);
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("detached commit"));
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("Choose a local branch"));

    let selected = fixture.merge_preview(Some("main")).await;
    assert_eq!(selected["destination_branch"], "main");
    assert_eq!(selected["ready"], true);
}

#[tokio::test]
async fn a_missing_recorded_origin_requires_a_local_destination_choice() {
    let fixture = fixture().await;
    fixture
        .execute("UPDATE worktrees SET base_branch = 'release/gone'")
        .await;

    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["blocker"], "destination_selection_required");
    assert_eq!(preview["destination_branch"], serde_json::Value::Null);
    assert_eq!(preview["destination_checkout"], serde_json::Value::Null);
    assert_eq!(preview["requires_destination_selection"], true);
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("no longer exists"));
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("Choose a local branch"));

    let selected = fixture.merge_preview(Some("main")).await;
    assert_eq!(selected["destination_branch"], "main");
    assert_eq!(selected["ready"], true);
}

#[tokio::test]
async fn an_origin_branch_without_the_recorded_starting_commit_requires_selection() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task.txt"), "source work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "source work"], &fixture.checkout);
    let source_commit = git(&["rev-parse", "HEAD"], &fixture.checkout);
    fixture
        .execute(&format!(
            "UPDATE worktrees SET base_commit = '{source_commit}'"
        ))
        .await;

    let preview = fixture.merge_preview(None).await;
    assert_eq!(preview["blocker"], "destination_selection_required");
    assert_eq!(preview["destination_branch"], serde_json::Value::Null);
    assert_eq!(preview["destination_checkout"], serde_json::Value::Null);
    assert_eq!(preview["requires_destination_selection"], true);
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("cannot be verified"));
    assert!(preview["reason"]
        .as_str()
        .unwrap()
        .contains("Choose a local branch"));

    let selected = fixture.merge_preview(Some("main")).await;
    assert_eq!(selected["destination_branch"], "main");
    assert_eq!(selected["ready"], true);
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
