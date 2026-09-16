use super::*;

#[tokio::test]
async fn ambient_merge_options_preserve_normal_merge_policy() {
    for option in ["--squash", "--no-commit", "--squash --no-commit"] {
        for divergent in [false, true] {
            let fixture = fixture().await;
            let repository = fixture._directory.path().join("repositories/ticketry");
            if divergent {
                write(&repository.join("destination.txt"), "destination work\n");
                git(&["add", "."], &repository);
                git(&["commit", "-m", "destination work"], &repository);
            }
            write(&fixture.checkout.join("source.txt"), "source work\n");
            git(&["add", "."], &fixture.checkout);
            git(&["commit", "-m", "source work"], &fixture.checkout);
            git(&["config", "branch.main.mergeOptions", option], &repository);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let hooks = repository.join(".git/policy-test-hooks");
                let hook = hooks.join("post-merge");
                write(
                    &hook,
                    r#"#!/bin/sh
echo "$1" > "$(git rev-parse --git-path policy-hook-ran)"
"#,
                );
                std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
                    .expect("make hook executable");
                git(
                    &["config", "core.hooksPath", hooks.to_str().unwrap()],
                    &repository,
                );
            }
            let preview = fixture.merge_preview(None).await;
            assert_eq!(
                preview["ready"], true,
                "{option}, divergent={divergent}: {preview}"
            );
            let source = git(&["rev-parse", "HEAD"], &fixture.checkout);
            let destination = git(&["rev-parse", "HEAD"], &repository);
            let response = fixture
                .merge("90000000-0000-0000-0000-000000000019", &preview)
                .await;
            assert_eq!(
                response["errors"],
                serde_json::Value::Null,
                "{option}, divergent={divergent}: {response}"
            );
            assert_eq!(
                response["data"]["worktree_merge"]["outcome"],
                if divergent {
                    "merged"
                } else {
                    "fast_forwarded"
                },
                "{option}, divergent={divergent}: {response}"
            );
            #[cfg(unix)]
            assert_eq!(
                std::fs::read_to_string(repository.join(".git/policy-hook-ran"))
                    .expect("configured post-merge hook must run"),
                "0\n"
            );
            let head = git(&["rev-parse", "HEAD"], &repository);
            if divergent {
                assert_eq!(
                    git(&["rev-list", "--parents", "-n", "1", "HEAD"], &repository),
                    format!("{head} {destination} {source}")
                );
            } else {
                assert_eq!(head, source);
            }
            git(
                &["merge-base", "--is-ancestor", &source, "HEAD"],
                &repository,
            );
            assert_eq!(git(&["rev-parse", "HEAD"], &fixture.checkout), source);
            assert_eq!(git(&["status", "--porcelain"], &repository), "");
            assert_eq!(git(&["status", "--porcelain"], &fixture.checkout), "");
            let merge_head = git(&["rev-parse", "--git-path", "MERGE_HEAD"], &repository);
            assert!(!repository.join(merge_head).exists());
            assert_eq!(
                git(&["config", "branch.main.mergeOptions"], &repository),
                option
            );
        }
    }
}
