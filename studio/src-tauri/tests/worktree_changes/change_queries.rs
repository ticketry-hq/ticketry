use super::*;

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
        "query": include_str!("../../../src/features/agents/worktrees/operations/currentWorktrees.graphql"),
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
        "query": "query ModuleFiles($moduleId: String!) { module_version_control(module_id: $moduleId) { checkout { available files { path } } } }",
        "variables": { "moduleId": MODULE_PUBLIC },
    }).to_string()).await;
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    assert_eq!(
        response["data"]["module_version_control"]["checkout"]["available"],
        true
    );
}
