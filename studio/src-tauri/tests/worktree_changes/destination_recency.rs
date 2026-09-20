use super::*;

#[tokio::test]
async fn destinations_are_ranked_by_latest_commit_with_branch_name_ties() {
    let fixture = fixture().await;
    let repository = fixture._directory.path().join("repositories/ticketry");
    let tree = git(&["rev-parse", "HEAD^{tree}"], &repository);
    for (branch, date) in [
        ("a-older", "2035-01-01T00:00:00Z"),
        ("z-newer", "2036-01-01T00:00:00Z"),
        ("b-newer", "2036-01-01T00:00:00Z"),
    ] {
        let output = Command::new("git")
            .args([
                "commit-tree",
                &tree,
                "-p",
                &fixture.base_commit,
                "-m",
                branch,
            ])
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .current_dir(&repository)
            .output()
            .expect("create dated commit");
        assert!(output.status.success());
        let commit = String::from_utf8(output.stdout).unwrap();
        git(&["branch", branch, commit.trim()], &repository);
    }

    let preview = fixture.merge_preview(None).await;
    let branches: Vec<_> = preview["destinations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entry| entry["branch"].as_str())
        .collect();
    assert_eq!(&branches[..3], &["b-newer", "z-newer", "a-older"]);
    assert_eq!(preview["destination_branch"], "main");
}
