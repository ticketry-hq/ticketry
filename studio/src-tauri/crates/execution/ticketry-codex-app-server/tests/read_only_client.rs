#[cfg(unix)]
mod unix {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use serde_json::Value;
    use tempfile::TempDir;
    use ticketry_codex_app_server::{CodexAppServerClient, CodexThreadTitleReader};

    struct ScriptedAppServer {
        _directory: TempDir,
        executable: PathBuf,
        requests: PathBuf,
        launches: PathBuf,
    }

    impl ScriptedAppServer {
        fn named(title: &str) -> Self {
            Self::responding_with_thread(serde_json::json!({"name": title}))
        }

        fn responding_with_thread(thread: Value) -> Self {
            let directory = tempfile::tempdir().expect("create scripted app-server directory");
            let executable = directory.path().join("codex");
            let requests = directory.path().join("requests.jsonl");
            let launches = directory.path().join("launches");
            let script = format!(
                "#!/bin/sh\nrequests='{}'\nlaunches='{}'\nthread_json='{}'\nprintf '%s\\n' launched >> \"$launches\"\nrequest_id=0\nwhile IFS= read -r request; do\n  printf '%s\\n' \"$request\" >> \"$requests\"\n  request_id=$((request_id + 1))\n  if [ \"$request_id\" -eq 1 ]; then\n    printf '{{\"id\":%s,\"result\":{{}}}}\\n' \"$request_id\"\n  else\n    printf '{{\"id\":%s,\"result\":{{\"thread\":%s}}}}\\n' \"$request_id\" \"$thread_json\"\n  fi\ndone\n",
                shell_literal(&requests),
                shell_literal(&launches),
                serde_json::to_string(&thread)
                    .expect("serialize thread")
                    .replace('\'', "'\\\"'\\\"'")
            );
            fs::write(&executable, script).expect("write scripted app-server");
            let mut permissions = fs::metadata(&executable)
                .expect("read scripted app-server metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&executable, permissions)
                .expect("make scripted app-server executable");
            Self {
                _directory: directory,
                executable,
                requests,
                launches,
            }
        }

        fn initializing_then_exiting() -> Self {
            let directory = tempfile::tempdir().expect("create scripted app-server directory");
            let executable = directory.path().join("codex");
            let requests = directory.path().join("requests.jsonl");
            let launches = directory.path().join("launches");
            let script = format!(
                "#!/bin/sh\nlaunches='{}'\nprintf '%s\\n' launched >> \"$launches\"\nIFS= read -r request\nprintf '{{\"id\":1,\"result\":{{}}}}\\n'\n",
                shell_literal(&launches),
            );
            fs::write(&executable, script).expect("write scripted app-server");
            let mut permissions = fs::metadata(&executable)
                .expect("read scripted app-server metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&executable, permissions)
                .expect("make scripted app-server executable");
            Self {
                _directory: directory,
                executable,
                requests,
                launches,
            }
        }

        fn never_answering_reads() -> Self {
            let directory = tempfile::tempdir().expect("create scripted app-server directory");
            let executable = directory.path().join("codex");
            let requests = directory.path().join("requests.jsonl");
            let launches = directory.path().join("launches");
            let script = format!(
                "#!/bin/sh\nrequests='{}'\nprintf '{{\"id\":1,\"result\":{{}}}}\\n'\nIFS= read -r request\nprintf '%s\\n' \"$request\" >> \"$requests\"\nwhile :; do sleep 30; done\n",
                shell_literal(&requests),
            );
            fs::write(&executable, script).expect("write scripted app-server");
            let mut permissions = fs::metadata(&executable)
                .expect("read scripted app-server metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&executable, permissions)
                .expect("make scripted app-server executable");
            Self {
                _directory: directory,
                executable,
                requests,
                launches,
            }
        }

        fn requests(&self) -> Vec<Value> {
            fs::read_to_string(&self.requests)
                .expect("read captured requests")
                .lines()
                .map(|line| serde_json::from_str(line).expect("captured request is JSON"))
                .collect()
        }

        fn launch_count(&self) -> usize {
            fs::read_to_string(&self.launches)
                .unwrap_or_default()
                .lines()
                .count()
        }
    }

    fn shell_literal(path: &Path) -> String {
        path.to_string_lossy().replace('\'', "'\\\"'\\\"'")
    }

    #[tokio::test]
    async fn reads_an_accepted_name_without_starting_or_resuming_the_thread() {
        let server = ScriptedAppServer::named("Fix the flaky launch test");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");
        let second_title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776246")
            .await
            .expect("read a second title through the resident process");

        assert_eq!(title.as_deref(), Some("Fix the flaky launch test"));
        assert_eq!(second_title, title);
        let requests = server.requests();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[0]["params"]["clientInfo"]["name"], "ticketry");
        assert_eq!(requests[1]["method"], "thread/read");
        assert_eq!(
            requests[1]["params"],
            serde_json::json!({
                "threadId": "019e9428-9788-7df0-84cd-755e1b776245",
                "includeTurns": false,
            })
        );
        assert_eq!(requests[2]["method"], "thread/read");
        assert!(requests.iter().all(|request| {
            matches!(
                request["method"].as_str(),
                Some("initialize" | "thread/read")
            )
        }));
    }

    #[tokio::test]
    async fn rejects_a_blank_thread_name() {
        let server = ScriptedAppServer::named("   \n  ");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");

        assert_eq!(title, None);
    }

    #[tokio::test]
    async fn ignores_preview_when_name_is_absent() {
        let server = ScriptedAppServer::responding_with_thread(
            serde_json::json!({"preview": "Private launch prompt"}),
        );
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");

        assert_eq!(title, None);
    }

    #[tokio::test]
    async fn a_missing_codex_executable_starts_no_child() {
        let directory = tempfile::tempdir().expect("create empty executable directory");
        let result = CodexAppServerClient::start(directory.path().join("missing-codex")).await;

        assert!(result.is_err());
        assert!(fs::read_dir(directory.path())
            .expect("read empty executable directory")
            .next()
            .is_none());
    }

    #[tokio::test]
    async fn bounds_a_stuck_app_server_read() {
        let server = ScriptedAppServer::never_answering_reads();
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let result = tokio::time::timeout(
            Duration::from_secs(6),
            client.read_thread_title("stuck-thread"),
        )
        .await
        .expect("client applies its own response timeout");
        let error = result.expect_err("stuck read reports an error");

        assert!(error.to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn gives_up_when_the_app_server_keeps_exiting_after_initialize() {
        let server = ScriptedAppServer::initializing_then_exiting();
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("initialize the first app-server");
        let mut restarts = client.subscribe_restarts();

        tokio::time::sleep(Duration::from_secs(3)).await;
        let bounded_launches = server.launch_count();
        assert!(
            bounded_launches <= 6,
            "spawned {bounded_launches} app-servers"
        );
        assert!(matches!(
            restarts.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(server.launch_count(), bounded_launches);
        let error = client
            .read_thread_title("unavailable-thread")
            .await
            .expect_err("reader stays unavailable after giving up");
        assert!(error.to_string().contains("unavailable"));
    }
}
