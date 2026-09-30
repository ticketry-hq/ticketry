use super::*;

#[tokio::test]
async fn source_work_does_not_block_confirmed_merge_recovery_after_restart() {
    for commit_source in [false, true] {
        for finish in [false, true] {
            let mut fixture = fixture().await;
            let repository = fixture._directory.path().join("repositories/ticketry");
            write(&repository.join("conflict.txt"), "destination side\n");
            git(&["commit", "-am", "destination side"], &repository);
            write(&fixture.checkout.join("conflict.txt"), "source side\n");
            git(&["commit", "-am", "source side"], &fixture.checkout);
            let preview = fixture.merge_preview(None).await;
            let operation_id = "90000000-0000-0000-0000-000000000018";
            let merged = fixture.merge(operation_id, &preview).await;
            assert_eq!(
                merged["data"]["worktree_merge"]["outcome"], "conflicted",
                "{merged}"
            );

            write(&fixture.checkout.join("README.md"), "new source work\n");
            git(&["add", "README.md"], &fixture.checkout);
            if commit_source {
                git(&["commit", "-m", "continue source work"], &fixture.checkout);
            } else {
                write(
                    &fixture.checkout.join("src/unstaged.rs"),
                    "unstaged source work\n",
                );
                write(
                    &fixture.checkout.join("untracked.txt"),
                    "untracked source work\n",
                );
            }
            let source_head = git(&["rev-parse", "HEAD"], &fixture.checkout);
            let source_status = git(&["status", "--porcelain"], &fixture.checkout);
            let source_index = git(&["diff", "--cached"], &fixture.checkout);
            let source_diff = git(&["diff"], &fixture.checkout);
            let destination_status = git(&["status", "--porcelain"], &repository);
            write(&repository.join("keep-untracked.txt"), "destination work\n");

            let recovered = fixture.merge_recovery().await;
            assert_eq!(recovered["errors"], serde_json::Value::Null, "{recovered}");
            assert_eq!(
                recovered["data"]["worktree_merge_recovery"]["outcome"],
                "conflicted"
            );
            let restarted = TransportApiImpl::new();
            initialize_with_worktracker_commands_and_install(
                &fixture._directory.path().join("rust-core.sqlite3"),
                &fixture._directory.path().join("state.db"),
                &fixture._directory.path().join("media"),
                &restarted,
            )
            .await
            .expect("restart schema against the persisted journal");
            fixture.api = restarted;
            assert_eq!(fixture.merge_recovery().await, recovered);
            assert_eq!(
                git(&["rev-parse", "MERGE_HEAD"], &repository),
                preview["source_commit"]
            );
            assert_eq!(
                git(&["status", "--porcelain"], &repository),
                format!("{destination_status}\n?? keep-untracked.txt")
            );

            let settled = if finish {
                write(&repository.join("conflict.txt"), "resolved\n");
                git(&["add", "conflict.txt"], &repository);
                fixture.finish_merge(operation_id).await
            } else {
                fixture.abort_merge(operation_id).await
            };
            assert_eq!(settled["errors"], serde_json::Value::Null, "{settled}");
            let field = if finish {
                "worktree_merge_finish"
            } else {
                "worktree_merge_abort"
            };
            assert_eq!(
                settled["data"][field]["outcome"],
                if finish { "merged" } else { "aborted" }
            );
            if finish {
                git(
                    &[
                        "merge-base",
                        "--is-ancestor",
                        preview["source_commit"].as_str().unwrap(),
                        "HEAD",
                    ],
                    &repository,
                );
                assert_eq!(git(&["show", "HEAD:README.md"], &repository), "base");
            } else {
                assert_eq!(
                    git(&["rev-parse", "HEAD"], &repository),
                    preview["destination_commit"]
                );
                assert_eq!(
                    std::fs::read_to_string(repository.join("conflict.txt")).unwrap(),
                    "destination side\n"
                );
            }
            assert_eq!(
                git(&["status", "--porcelain"], &repository),
                "?? keep-untracked.txt"
            );
            assert_eq!(
                std::fs::read_to_string(repository.join("keep-untracked.txt")).unwrap(),
                "destination work\n"
            );
            assert_eq!(git(&["rev-parse", "HEAD"], &fixture.checkout), source_head);
            assert_eq!(
                git(&["status", "--porcelain"], &fixture.checkout),
                source_status
            );
            assert_eq!(git(&["diff", "--cached"], &fixture.checkout), source_index);
            assert_eq!(git(&["diff"], &fixture.checkout), source_diff);
            if !commit_source {
                assert_eq!(
                    std::fs::read_to_string(fixture.checkout.join("untracked.txt")).unwrap(),
                    "untracked source work\n"
                );
            }
            assert_eq!(
                fixture.merge_recovery().await["data"]["worktree_merge_recovery"],
                serde_json::Value::Null
            );
        }
    }
}
